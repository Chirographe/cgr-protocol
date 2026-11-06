import { ZERO_HASH, hashOf, sameValue, type Hash } from '../crypto/hash.ts'
import type { KeyVault } from '../guardian/keyring.ts'
import type { MailboxStore } from '../guardian/mailbox.ts'
import type { GuardianStore, IndexEntry, RecoveryRequest } from '../guardian/store.ts'
import { hashLine } from '../ledger/line.ts'
import type { Head, Line } from '../model/ledger.ts'
import type { FraudProof } from '../model/responses.ts'
import type { Rotation, State, Token } from '../model/token.ts'
import type { Followed, WitnessStore } from '../witness/store.ts'

/**
 * What any storage technology must guarantee. Each adapter runs these cases in its own tests,
 * with whatever test runner it uses. A case fails by throwing.
 */
export interface ConformanceCase {
  name: string
  run(): Promise<void>
}

type Open<T> = () => T | Promise<T>

function check(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

const same = (actual: unknown, expected: unknown, message: string) =>
  check(sameValue(actual, expected), message)

async function rejects(work: () => Promise<unknown>, message: string): Promise<void> {
  let failed = false
  await work().catch(() => {
    failed = true
  })
  check(failed, message)
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 1))

const DATE = '2026-11-06T12:00:00.000Z'
const KEY_A = 'p256:AAAA'
const KEY_B = 'p256:BBBB'

const hash = (label: string): Hash => hashOf(label)

const line = (n: number, fields: Partial<Line> = {}): Line => ({
  n,
  type: 'creation',
  token_id: hash(`token ${n}`),
  state_hash: hash(`state ${n}`),
  spent: null,
  origin: null,
  date: DATE,
  ...fields,
})

const rotation = (label: string): Rotation => ({
  previous: `p256:${label}`,
  next: `p256:${label}x`,
  previous_signature: 'AAAA',
  next_signature: 'BBBB',
})

const head = (n: number, label = 'root'): Head => ({
  n,
  root: hash(label),
  date: DATE,
  signature: 'AAAA',
})

// Opaque to a store: only its content must come back unchanged.
const token = (label: string) =>
  ({
    format: 'chirographe/1',
    state: { token_id: hash(label), ephemeral: KEY_A, sequence: 3, previous: null },
    signatures: { senders: [{ type: 'raw', key: KEY_A, signature: 'AAAA' }] },
  }) as unknown as Token

const state = (label: string) => token(label).state as State

const indexEntry = (id: Hash, fields: Partial<IndexEntry> = {}): IndexEntry => ({
  token_id: id,
  n: 1,
  state_hash: hash('state'),
  here: true,
  moved_to: null,
  sequence: 0,
  ...fields,
})

const recovery = (id: Hash, fields: Partial<RecoveryRequest> = {}): RecoveryRequest => ({
  token_id: id,
  state_hash: hash('state'),
  proposal: token('proposal'),
  previous: state('previous'),
  ends_at: DATE,
  status: 'announced',
  line: 4,
  ...fields,
})

export function guardianStoreCases(open: Open<GuardianStore>): ConformanceCase[] {
  const inStore = (name: string, run: (store: GuardianStore) => Promise<void>) => ({
    name,
    run: async () => run(await open()),
  })

  return [
    inStore('starts empty', async (store) => {
      check((await store.publishedHead()) === null, 'a new store has a head')
      check((await store.transaction((tx) => tx.lineCount())) === 0, 'a new store has lines')
    }),

    inStore('appends lines and reads them back in pages', async (store) => {
      const lines = [
        line(1),
        line(2, { spent: hash('a'), origin: { guardian: KEY_A, line: 9 } }),
        line(3),
      ]
      await store.transaction(async (tx) => {
        for (const entry of lines) await tx.appendLine(entry)
      })
      await store.transaction(async (tx) => {
        check((await tx.lineCount()) === 3, 'wrong line count')
        same(await tx.lines(1, 500), lines, 'lines changed in storage')
        same(await tx.lines(2, 1), [lines[1]], 'wrong page')
        same(await tx.lines(4, 10), [], 'a page past the end is not empty')
        same(await tx.lineHashes(), lines.map(hashLine), 'wrong line hashes')
      })
    }),

    inStore('refuses a repeated spent, and only that', async (store) => {
      const spent = hash('spent')
      await store.transaction(async (tx) => {
        await tx.appendLine(line(1, { spent }))
        await tx.appendLine(line(2))
        await tx.appendLine(line(3))
      })
      await rejects(
        () => store.transaction((tx) => tx.appendLine(line(4, { spent }))),
        'a repeated spent was accepted',
      )
      const count = await store.transaction((tx) => tx.lineCount())
      check(count === 3, 'a refused line was kept')
    }),

    inStore('knows which states are consumed', async (store) => {
      const spent = hash('spent')
      await store.transaction((tx) => tx.appendLine(line(1, { spent })))
      await store.transaction(async (tx) => {
        check(await tx.isConsumed(spent), 'a spent state is not consumed')
        check(!(await tx.isConsumed(hash('other'))), 'an unspent state is consumed')
      })
    }),

    inStore('returns rotations in ledger order', async (store) => {
      const [first, second] = [rotation('A'), rotation('B')]
      await store.transaction(async (tx) => {
        await tx.appendLine(line(1, { type: 'rotation', token_id: ZERO_HASH, origin: first }))
        await tx.appendLine(line(2))
        await tx.appendLine(line(3, { type: 'rotation', token_id: ZERO_HASH, origin: second }))
      })
      const rotations = await store.transaction((tx) => tx.rotations())
      same(rotations, [first, second], 'wrong rotations')
    }),

    inStore('keeps tokens by state hash', async (store) => {
      const id = hash('state')
      await store.transaction((tx) => tx.saveToken(id, token('a')))
      await store.transaction(async (tx) => {
        same(await tx.token(id), token('a'), 'token changed in storage')
        check((await tx.token(hash('unknown'))) === null, 'an unknown token exists')
      })
      await store.transaction((tx) => tx.saveToken(id, token('b')))
      const replaced = await store.transaction((tx) => tx.token(id))
      same(replaced, token('b'), 'a token was not replaced')
    }),

    inStore('keeps one index entry per token', async (store) => {
      const [a, b] = [hash('a'), hash('b')]
      const group = { members: [{ key: KEY_B, url: 'https://b.test' }], threshold: 1 }
      const moved = indexEntry(a, { n: 2, here: false, moved_to: group, sequence: 1 })
      await store.transaction(async (tx) => {
        await tx.saveIndex(indexEntry(a))
        await tx.saveIndex(indexEntry(b))
        await tx.saveIndex(moved)
      })
      await store.transaction(async (tx) => {
        same(await tx.index(a), moved, 'index entry not replaced')
        check((await tx.index(hash('unknown'))) === null, 'an unknown entry exists')
        check((await tx.indexEntries()).length === 2, 'wrong number of entries')
      })
    }),

    inStore('saves and deletes commitments', async (store) => {
      const commitment = {
        state_hash: hash('state'),
        token_id: hash('token'),
        previous: state('previous'),
        date: DATE,
      }
      await store.transaction(async (tx) => {
        await tx.saveCommitment(commitment)
        await tx.saveCommitment(commitment)
        await tx.deleteCommitment(commitment.state_hash)
        await tx.deleteCommitment(hash('unknown'))
      })
    }),

    inStore('keeps one recovery request per token', async (store) => {
      const [a, b] = [hash('a'), hash('b')]
      const closed = recovery(a, { status: 'opposed' })
      await store.transaction(async (tx) => {
        await tx.saveRecovery(recovery(a))
        await tx.saveRecovery(recovery(b))
        await tx.saveRecovery(closed)
      })
      await store.transaction(async (tx) => {
        same(await tx.recovery(a), closed, 'recovery not replaced')
        check((await tx.recovery(hash('unknown'))) === null, 'an unknown recovery exists')
        check((await tx.recoveries()).length === 2, 'wrong number of recoveries')
      })
    }),

    inStore('rolls back everything on error, and stays usable', async (store) => {
      const id = hash('token')
      await rejects(
        () =>
          store.transaction(async (tx) => {
            await tx.appendLine(line(1))
            await tx.saveToken(id, token('a'))
            await tx.saveIndex(indexEntry(id))
            await tx.saveRecovery(recovery(id))
            throw new Error('abort')
          }),
        'the error was swallowed',
      )
      await store.transaction(async (tx) => {
        check((await tx.lineCount()) === 0, 'a line survived the rollback')
        check((await tx.token(id)) === null, 'a token survived the rollback')
        check((await tx.index(id)) === null, 'an index entry survived the rollback')
        check((await tx.recovery(id)) === null, 'a recovery survived the rollback')
        await tx.appendLine(line(1))
      })
    }),

    inStore('serializes transactions', async (store) => {
      const add = () =>
        store.transaction(async (tx) => {
          const n = (await tx.lineCount()) + 1
          await tick()
          await tx.appendLine(line(n))
        })
      await Promise.all([add(), add(), add(), add()])
      const count = await store.transaction((tx) => tx.lineCount())
      check(count === 4, 'concurrent transactions interleaved')
    }),

    inStore('publishes the head apart from transactions', async (store) => {
      await store.publishHead(head(0, 'a'))
      await store.publishHead(head(1, 'b'))
      same(await store.publishedHead(), head(1, 'b'), 'head not replaced')

      const failing = store.transaction(async (tx) => {
        await tx.appendLine(line(1))
        await tick()
        throw new Error('abort')
      })
      const published = store.publishHead(head(2, 'c'))
      await Promise.allSettled([failing, published])
      same(await store.publishedHead(), head(2, 'c'), 'a rollback took the head with it')
    }),
  ]
}

const relayMessage = (ciphertext: string) => ({ ephemeral: KEY_A, ciphertext })

export function mailboxStoreCases(open: Open<MailboxStore>): ConformanceCase[] {
  const inStore = (name: string, run: (store: MailboxStore) => Promise<void>) => ({
    name,
    run: async () => run(await open()),
  })

  return [
    inStore('keeps messages per mailbox, oldest first', async (store) => {
      const first = await store.add(KEY_A, DATE, relayMessage('AAAA'))
      const second = await store.add(KEY_A, DATE, relayMessage('BBBB'))
      const other = await store.add(KEY_B, DATE, relayMessage('CCCC'))
      check(new Set([first, second, other]).size === 3, 'ids are not unique')
      same(
        await store.list(KEY_A),
        [
          { id: first, date: DATE, content: relayMessage('AAAA') },
          { id: second, date: DATE, content: relayMessage('BBBB') },
        ],
        'wrong mailbox content',
      )
    }),

    inStore('removes a message from its own mailbox only', async (store) => {
      const id = await store.add(KEY_A, DATE, relayMessage('AAAA'))
      await store.remove(KEY_B, id)
      check((await store.list(KEY_A)).length === 1, 'a message left through another mailbox')
      await store.remove(KEY_A, id)
      check((await store.list(KEY_A)).length === 0, 'a message was not removed')
      await store.remove(KEY_A, id)
    }),
  ]
}

const followed = (key: string, fields: Partial<Followed> = {}): Followed => ({
  key,
  url: 'https://a.test',
  current: key,
  lastAnswer: null,
  lastHead: null,
  countersignature: null,
  ...fields,
})

const fraud = (guardian: string, reason: string, root: string): FraudProof => ({
  guardian,
  reason,
  head_a: head(1, root),
  head_b: null,
  date: DATE,
})

export function witnessStoreCases(open: Open<WitnessStore>): ConformanceCase[] {
  const inStore = (name: string, run: (store: WitnessStore) => Promise<void>) => ({
    name,
    run: async () => run(await open()),
  })

  return [
    inStore('keeps one entry per guardian', async (store) => {
      const updated = followed(KEY_A, {
        current: KEY_B,
        lastAnswer: DATE,
        lastHead: head(1),
        countersignature: {
          guardian: KEY_A,
          n: 1,
          root: hash('root'),
          date: DATE,
          signature: 'AAAA',
        },
      })
      await store.saveFollowed(followed(KEY_A))
      await store.saveFollowed(followed(KEY_B))
      await store.saveFollowed(updated)
      const entries = await store.followed()
      check(entries.length === 2, 'wrong number of entries')
      same(
        entries.find((entry) => entry.key === KEY_A),
        updated,
        'entry not replaced',
      )
    }),

    inStore('keeps the first head seen at each line', async (store) => {
      same(await store.recordHead(KEY_A, head(1, 'a')), head(1, 'a'), 'first head not returned')
      same(await store.recordHead(KEY_A, head(1, 'b')), head(1, 'a'), 'first head was replaced')
      same(await store.recordHead(KEY_A, head(2, 'b')), head(2, 'b'), 'lines are mixed up')
      same(await store.recordHead(KEY_B, head(1, 'b')), head(1, 'b'), 'guardians are mixed up')
    }),

    inStore('records concurrent heads atomically', async (store) => {
      const kept = await Promise.all([
        store.recordHead(KEY_A, head(1, 'a')),
        store.recordHead(KEY_A, head(1, 'b')),
      ])
      same(kept[0], kept[1], 'two heads were kept for one line')
    }),

    inStore('keeps one proof per reason and root', async (store) => {
      const first = await store.recordFraud(fraud(KEY_A, 'fork', 'a'))
      same(first, fraud(KEY_A, 'fork', 'a'), 'proof not returned')
      const later = { ...fraud(KEY_A, 'fork', 'a'), date: '2027-01-01T00:00:00.000Z' }
      same(await store.recordFraud(later), first, 'the first proof was not kept')
      await store.recordFraud(fraud(KEY_A, 'fork', 'b'))
      await store.recordFraud(fraud(KEY_A, 'other', 'a'))
      await store.recordFraud(fraud(KEY_B, 'fork', 'a'))
      const proofs = await store.frauds(KEY_A)
      same(
        proofs,
        [fraud(KEY_A, 'fork', 'a'), fraud(KEY_A, 'fork', 'b'), fraud(KEY_A, 'other', 'a')],
        'wrong proofs',
      )
    }),
  ]
}

export function keyVaultCases(open: Open<KeyVault>): ConformanceCase[] {
  return [
    {
      name: 'keeps the last value saved',
      run: async () => {
        const vault = await open()
        check((await vault.load()) === null, 'a new vault is not empty')
        await vault.save('first')
        await vault.save('second')
        check((await vault.load()) === 'second', 'wrong vault content')
      },
    },
  ]
}
