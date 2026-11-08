import type { GuardianStore } from '../guardian/store.ts'
import { hashLine } from '../ledger/line.ts'
import { indexEntry, line, notice, rotation, transition } from './guardian-fixtures.ts'
import {
  KEY_B,
  casesOn,
  check,
  hash,
  head,
  rejects,
  same,
  tick,
  type ConformanceCase,
  type Open,
} from './support.ts'

export function guardianStoreCases(open: Open<GuardianStore>): ConformanceCase[] {
  const inStore = casesOn(open)
  return [
    inStore('starts empty', async (store) => {
      check((await store.publishedHead()) === null, 'a new store has a head')
      check((await store.transaction((tx) => tx.lineCount())) === 0, 'a new store has lines')
    }),

    inStore('appends lines and reads them back in pages', async (store) => {
      const lines = [line(1), line(2, { spent: [hash('a'), hash('b')] }), line(3)]
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

    inStore('refuses a value spent twice, and only that', async (store) => {
      await store.transaction(async (tx) => {
        await tx.appendLine(line(1, { spent: [hash('a'), hash('b')] }))
        await tx.appendLine(line(2))
      })
      await rejects(
        () => store.transaction((tx) => tx.appendLine(line(3, { spent: [hash('c'), hash('b')] }))),
        'a value spent twice was accepted',
      )
      check((await store.transaction((tx) => tx.lineCount())) === 2, 'a refused line was kept')
      await store.transaction((tx) => tx.appendLine(line(3, { spent: [hash('c')] })))
    }),

    inStore('knows which values are spent', async (store) => {
      await store.transaction((tx) => tx.appendLine(line(1, { spent: [hash('a')] })))
      await store.transaction(async (tx) => {
        check(await tx.isSpent(hash('a')), 'a spent value is not spent')
        check(!(await tx.isSpent(hash('other'))), 'an unspent value is spent')
      })
    }),

    inStore('returns rotations in order', async (store) => {
      const [first, second] = [rotation('A'), rotation('B')]
      await store.transaction(async (tx) => {
        await tx.saveRotation(first)
        await tx.saveRotation(second)
      })
      same(await store.transaction((tx) => tx.rotations()), [first, second], 'wrong rotations')
    }),

    inStore('keeps transitions by body hash', async (store) => {
      const id = hash('body')
      await store.transaction((tx) => tx.saveTransition(id, transition('a')))
      await store.transaction(async (tx) => {
        same(await tx.transition(id), transition('a'), 'transition changed in storage')
        check((await tx.transition(hash('unknown'))) === null, 'an unknown transition exists')
      })
      await store.transaction((tx) => tx.saveTransition(id, transition('b')))
      same(await store.transaction((tx) => tx.transition(id)), transition('b'), 'not replaced')
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

    inStore('lists claims per output, in order', async (store) => {
      const [a, b] = [hash('a'), hash('b')]
      await store.transaction(async (tx) => {
        await tx.saveClaim({ output: a, transition: hash('1') })
        await tx.saveClaim({ output: b, transition: hash('2') })
        await tx.saveClaim({ output: a, transition: hash('3') })
      })
      same(await store.transaction((tx) => tx.claims(a)), [hash('1'), hash('3')], 'wrong claims')
    }),

    inStore('saves, reads and deletes commitments', async (store) => {
      const commitment = {
        transition: hash('body'),
        tokens: [hash('token')],
        date: '2026-11-06T12:00:00.000Z',
      }
      await store.transaction(async (tx) => {
        await tx.saveCommitment(commitment)
        same(await tx.commitment(commitment.transition), commitment, 'commitment changed')
        await tx.deleteCommitment(commitment.transition)
        await tx.deleteCommitment(hash('unknown'))
        check((await tx.commitment(commitment.transition)) === null, 'commitment not deleted')
      })
    }),

    inStore('keeps one notice per token', async (store) => {
      const [a, b] = [hash('a'), hash('b')]
      const closed = notice(a, { status: 'opposed' })
      await store.transaction(async (tx) => {
        await tx.saveNotice(notice(a))
        await tx.saveNotice(notice(b))
        await tx.saveNotice(closed)
      })
      await store.transaction(async (tx) => {
        same(await tx.notice(a), closed, 'notice not replaced')
        check((await tx.notice(hash('unknown'))) === null, 'an unknown notice exists')
        check((await tx.notices()).length === 2, 'wrong number of notices')
      })
    }),

    inStore('rolls back everything on error, and stays usable', async (store) => {
      const id = hash('token')
      await rejects(
        () =>
          store.transaction(async (tx) => {
            await tx.appendLine(line(1))
            await tx.saveTransition(id, transition('a'))
            await tx.saveIndex(indexEntry(id))
            await tx.saveNotice(notice(id))
            await tx.saveRotation(rotation('A'))
            await tx.saveClaim({ output: id, transition: id })
            throw new Error('abort')
          }),
        'the error was swallowed',
      )
      await store.transaction(async (tx) => {
        check((await tx.lineCount()) === 0, 'a line survived the rollback')
        check((await tx.transition(id)) === null, 'a transition survived the rollback')
        check((await tx.index(id)) === null, 'an index entry survived the rollback')
        check((await tx.notice(id)) === null, 'a notice survived the rollback')
        check((await tx.rotations()).length === 0, 'a rotation survived the rollback')
        check((await tx.claims(id)).length === 0, 'a claim survived the rollback')
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
      check((await store.transaction((tx) => tx.lineCount())) === 4, 'transactions interleaved')
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
