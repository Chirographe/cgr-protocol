import { beforeEach, describe, expect, it } from 'vitest'
import {
  Guardian,
  MemoryGuardianStore,
  QuorumError,
  acceptProposal,
  commit,
  composeProposal,
  composeToken,
  createToken,
  generateSigner,
  hashLine,
  hashOf,
  hashToBytes,
  ledgerRoot,
  memoryKeyring,
  signersForState,
  soleOwner,
  validateToken,
  type Group,
  type Line,
  type Policy,
  type Token,
  type Wallet,
} from '../src/index.ts'
import { Network, directAddress, groupOf, guardians, mint, newWallet } from './network.ts'

const owner = (wallet: Wallet) => {
  const { keys, threshold } = directAddress(wallet)
  return { owner: { keys, threshold } }
}

async function transfer(net: Network, token: Token, from: Wallet, to: Wallet, guardian?: Group) {
  const proposal = await composeProposal(token, {
    signers: signersForState(from, token.state),
    recipient: owner(to),
    expiresIn: 3600,
    now: net.now,
    ...(guardian ? { guardian } : {}),
  })
  const accepted = await acceptProposal(proposal, signersForState(to, proposal.state))
  return commit(net.directory, accepted, token)
}

describe('single guardian', () => {
  let net: Network
  let x: Guardian
  let group: Group
  let alice: Wallet
  let bob: Wallet
  let charlie: Wallet
  let token: Token

  beforeEach(async () => {
    net = new Network()
    ;[x] = (await guardians(net, ['x'])) as [Guardian]
    group = groupOf([x], 1)
    alice = newWallet()
    bob = newWallet()
    charlie = newWallet()
    token = await mint(net, alice, group)
  })

  it('records a creation', async () => {
    expect(() => validateToken(token, { stage: 'final' })).not.toThrow()
    const [line] = await x.lines(1, 10)
    expect(line).toMatchObject({ n: 1, type: 'creation', spent: null })
    expect(await x.tokenHead(token.state.token_id)).toMatchObject({ here: true, n: 1 })
  })

  it('returns the stored token when a creation is replayed', async () => {
    await expect(x.create(token)).resolves.toBeDefined()
    expect(await x.lines(1, 10)).toHaveLength(1)
  })

  it('refuses a second state 0 for the same token', async () => {
    const state = { ...token.state, date: '2026-11-06T13:00:00.000Z' }
    const message = hashToBytes(hashOf(state))
    const [signer] = signersForState(alice, token.state)
    const senders = [
      {
        type: 'raw' as const,
        key: signer?.key as string,
        signature: (await signer?.sign(message)) as string,
      },
    ]
    await expect(x.create({ ...token, state, signatures: { senders } })).rejects.toMatchObject({
      code: 'STATE_ALREADY_SPENT',
    })
  })

  it('transfers', async () => {
    const final = await transfer(net, token, alice, bob)
    expect(() => validateToken(final, { stage: 'final', previous: token.state })).not.toThrow()
    const lines = await x.lines(1, 10)
    expect(lines[1]).toMatchObject({ type: 'transfer', spent: hashOf(token.state) })
  })

  it('refuses a double spend', async () => {
    await transfer(net, token, alice, bob)
    await expect(transfer(net, token, alice, charlie)).rejects.toMatchObject({
      code: 'STATE_ALREADY_SPENT',
    })
  })

  it('lets only one of two concurrent spends through', async () => {
    const results = await Promise.allSettled([
      transfer(net, token, alice, bob),
      transfer(net, token, alice, charlie),
    ])
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
    expect(await x.lines(1, 10)).toHaveLength(2)
  })

  it('resumes a commit: replaying adds no line', async () => {
    const proposal = await composeProposal(token, {
      signers: signersForState(alice, token.state),
      recipient: owner(bob),
      expiresIn: 3600,
      now: net.now,
    })
    const accepted = await acceptProposal(proposal, signersForState(bob, proposal.state))
    await commit(net.directory, accepted, token)
    await commit(net.directory, accepted, token)
    expect(await x.lines(1, 10)).toHaveLength(2)
  })

  it('cancels a proposal by a transfer to oneself', async () => {
    const pending = await composeProposal(token, {
      signers: signersForState(alice, token.state),
      recipient: owner(bob),
      expiresIn: 3600,
      now: net.now,
    })
    const cancel = await composeProposal(token, {
      signers: signersForState(alice, token.state),
      expiresIn: 3600,
      now: net.now,
    })
    await commit(net.directory, cancel, token)
    const accepted = await acceptProposal(pending, signersForState(bob, pending.state))
    await expect(commit(net.directory, accepted, token)).rejects.toMatchObject({
      code: 'STATE_ALREADY_SPENT',
    })
  })

  it('refuses unknown tokens and states', async () => {
    await expect(x.tokenHead(hashOf('nothing'))).rejects.toMatchObject({ code: 'UNKNOWN_STATE' })
    const next = await composeProposal(token, {
      signers: signersForState(alice, token.state),
      expiresIn: 3600,
      now: net.now,
    })
    const state = { ...next.state, previous: hashOf('elsewhere') }
    await expect(x.validate({ ...next, state })).rejects.toMatchObject({ code: 'UNKNOWN_STATE' })
    const other = { ...next, state: { ...next.state, token_id: hashOf('none') } }
    await expect(x.validate(other)).rejects.toMatchObject({ code: 'RULES_TAMPERED' })
    await expect(x.validate({ nothing: true })).rejects.toMatchObject({ code: 'INVALID_FORMAT' })
  })

  it('applies its policy', async () => {
    const policy: Policy = { creators: [], origins: [], maxProposalSeconds: 60 }
    x.setPolicy(policy)
    await expect(mint(net, bob, group)).rejects.toMatchObject({ code: 'POLICY_REFUSED' })
    await expect(transfer(net, token, alice, bob)).rejects.toMatchObject({
      code: 'POLICY_REFUSED',
    })
    expect((await x.info()).policy.open).toBe(false)
  })

  it('checks its own url', async () => {
    const wrong = { members: [{ key: x.key, url: 'https://elsewhere.test' }], threshold: 1 }
    const signer = generateSigner()
    const token2 = await composeToken({
      owner: soleOwner(signer.key),
      signers: [signer],
      subject: 'x',
      guardian: wrong,
    })
    await expect(x.create(token2)).rejects.toMatchObject({ code: 'INVALID_FORMAT' })
  })

  it('refuses tokens of other guardians', async () => {
    const [y] = (await guardians(net, ['y'])) as [Guardian]
    const signer = generateSigner()
    const foreign = await composeToken({
      owner: soleOwner(signer.key),
      signers: [signer],
      subject: 'x',
      guardian: groupOf([y], 1),
    })
    await expect(x.create(foreign)).rejects.toMatchObject({ code: 'INVALID_FORMAT' })
  })

  it('lists tokens by owner', async () => {
    const [entry] = await x.owners(1, 10)
    expect(entry?.owner).toEqual(token.state.owner)
    const key = token.state.owner.keys[0] as string
    expect(await x.tokensOf(key)).toHaveLength(1)
    expect(await x.tokensOf(generateSigner().key)).toHaveLength(0)
  })

  it('publishes a head matching its lines', async () => {
    await transfer(net, token, alice, bob)
    const head = await x.head()
    const lines = await x.lines(1, 10)
    expect(head.n).toBe(2)
    expect(head.root).toBe(ledgerRoot(lines.map(hashLine)))
    await expect(x.inclusionProof(1, 5)).rejects.toMatchObject({ code: 'UNKNOWN_STATE' })
  })
})

describe('integrity', () => {
  const open = async (store: MemoryGuardianStore, keyring = memoryKeyring()) =>
    Guardian.open({ name: 'x', url: 'https://x.test', store, keyring })

  it('locks itself when a line was rewritten', async () => {
    const store = new MemoryGuardianStore()
    const keyring = memoryKeyring()
    const guardian = await open(store, keyring)
    const signer = generateSigner()
    const token = await composeToken({
      owner: soleOwner(signer.key),
      signers: [signer],
      subject: 'x',
      guardian: groupOf([guardian], 1),
    })
    await guardian.create(token)
    store.tamper(1, { state_hash: hashOf('forged') })

    const reopened = await open(store, keyring)
    expect(reopened.locked).toBe(true)
    expect((await reopened.head()).locked).toBe(true)
    await expect(reopened.create(token)).rejects.toMatchObject({ code: 'LEDGER_LOCKED' })
    expect((await reopened.lines(1, 1)).length).toBe(1)
  })

  it('locks itself when the published head is gone', async () => {
    const store = new MemoryGuardianStore()
    const guardian = await open(store)
    const signer = generateSigner()
    await guardian.create(
      await composeToken({
        owner: soleOwner(signer.key),
        signers: [signer],
        subject: 'x',
        guardian: groupOf([guardian], 1),
      }),
    )
    Object.assign(store, { head: null })
    const reopened = await open(store)
    expect(reopened.locked).toBe(true)
    await expect(reopened.head()).rejects.toMatchObject({ code: 'LEDGER_LOCKED' })
  })

  it('detects a state spent twice on disk', async () => {
    const store = new MemoryGuardianStore()
    await store.transaction(async (tx) => {
      const line: Line = {
        n: 1,
        type: 'transfer',
        token_id: 'a',
        state_hash: 'b',
        spent: 'c',
        origin: null,
        date: 'd',
      }
      await tx.appendLine(line)
      await tx.appendLine({ ...line, n: 2, spent: 'e' })
    })
    store.tamper(2, { spent: 'c' })
    expect((await open(store)).locked).toBe(true)
  })

  it('refuses a duplicate spent in the store itself', async () => {
    const store = new MemoryGuardianStore()
    const line: Line = {
      n: 1,
      type: 'transfer',
      token_id: 'a',
      state_hash: 'b',
      spent: 'c',
      origin: null,
      date: 'd',
    }
    await expect(
      store.transaction(async (tx) => {
        await tx.appendLine(line)
        await tx.appendLine({ ...line, n: 2 })
      }),
    ).rejects.toThrow('spent must be unique')
    expect(await store.transaction((tx) => tx.lineCount())).toBe(0)
  })
})

describe('quorum of 3 out of 4', () => {
  let net: Network
  let members: Guardian[]
  let group: Group
  let alice: Wallet
  let bob: Wallet

  beforeEach(async () => {
    net = new Network()
    members = await guardians(net, ['a', 'b', 'c', 'd'])
    group = groupOf(members, 3)
    alice = newWallet()
    bob = newWallet()
  })

  it('stores the certificate on every member', async () => {
    const token = await mint(net, alice, group)
    expect(token.signatures.guardians).toHaveLength(4)
    for (const member of members) {
      const copy = await member.tokenHead(token.state.token_id)
      expect(copy.here).toBe(true)
    }
  })

  it('survives one member down, which catches up afterwards', async () => {
    const token = await mint(net, alice, group)
    const late = members[3] as Guardian
    net.down.add(late.url)
    const final = await transfer(net, token, alice, bob)
    expect(final.signatures.guardians).toHaveLength(3)

    net.down.delete(late.url)
    const charlie = newWallet()
    const third = await transfer(net, final, bob, charlie)
    expect(third.signatures.guardians).toHaveLength(4)
    const types = (await late.lines(1, 10)).map((line) => line.type)
    expect(types).toEqual(['creation', 'catch_up', 'transfer'])
  })

  it('stops with two members down, without losing anything', async () => {
    const token = await mint(net, alice, group)
    net.down.add('https://c.test').add('https://d.test')
    await expect(transfer(net, token, alice, bob)).rejects.toThrow(QuorumError)
    net.down.clear()
    await expect(transfer(net, token, alice, bob)).resolves.toBeDefined()
  })

  it('counts a member it cannot resolve as a failure', async () => {
    const token = await mint(net, alice, group)
    const directory = (url: string) => {
      if (url === 'https://d.test') throw new Error('no route')
      return net.directory(url)
    }
    const { keys, threshold } = directAddress(bob)
    const proposal = await composeProposal(token, {
      signers: signersForState(alice, token.state),
      recipient: { owner: { keys, threshold } },
      expiresIn: 3600,
      now: net.now,
    })
    const accepted = await acceptProposal(proposal, signersForState(bob, proposal.state))
    await expect(commit(directory, accepted, token)).resolves.toBeDefined()
  })

  it('refuses a certificate with too few votes', async () => {
    const token = await mint(net, alice, group)
    const votes = token.signatures.guardians?.slice(0, 2) ?? []
    const weak = { ...token, signatures: { ...token.signatures, guardians: votes } }
    await expect(
      (members[0] as Guardian).certify({ token: weak, previous: null }),
    ).rejects.toMatchObject({ code: 'INVALID_SIGNATURE' })
  })

  it('reports the refusal that blocks the quorum', async () => {
    const token = await mint(net, alice, group)
    await transfer(net, token, alice, bob)
    await expect(transfer(net, token, alice, newWallet())).rejects.toMatchObject({
      code: 'STATE_ALREADY_SPENT',
    })
  })

  it('does not count one member twice', async () => {
    const token = await mint(net, alice, group)
    const [first] = token.signatures.guardians ?? []
    const padded = [first, first, first] as NonNullable<Token['signatures']['guardians']>
    const forged = { ...token, signatures: { ...token.signatures, guardians: padded } }
    expect(() => validateToken(forged, { stage: 'final' })).toThrow('guardian quorum missing')
  })
})

describe('changing group', () => {
  let net: Network
  let x: Guardian
  let y: Guardian
  let token: Token
  let alice: Wallet

  beforeEach(async () => {
    net = new Network()
    ;[x, y] = (await guardians(net, ['x', 'y'])) as [Guardian, Guardian]
    alice = newWallet()
    token = await mint(net, alice, groupOf([x], 1))
  })

  const move =
    (wallet = alice, guardian = groupOf([y], 1)) =>
    async (from: Token) => {
      const next = await composeProposal(from, {
        signers: signersForState(wallet, from.state),
        guardian,
        expiresIn: 3600,
        now: net.now,
      })
      return commit(net.directory, next, from)
    }

  it('hands over: departure, arrival, then the old guardian refuses', async () => {
    const moved = await move()(token)
    expect((await x.lines(1, 5)).at(-1)).toMatchObject({ type: 'departure' })
    expect((await y.lines(1, 5)).at(-1)).toMatchObject({
      type: 'arrival',
      origin: { guardian: x.key, line: 2 },
    })
    expect(await x.tokenHead(token.state.token_id)).toMatchObject({ here: false })

    const next = await composeProposal(moved, {
      signers: signersForState(alice, moved.state),
      expiresIn: 3600,
      now: net.now,
    })
    await expect(x.validate(next)).rejects.toMatchObject({ code: 'TOKEN_MOVED' })
    await expect(commit(net.directory, next, moved)).resolves.toBeDefined()
  })

  it('combines a transfer and a change of group', async () => {
    const bob = newWallet()
    const final = await transfer(net, token, alice, bob, groupOf([y], 1))
    expect(final.state.owner).toEqual(owner(bob).owner)
    expect(await y.tokenHead(token.state.token_id)).toMatchObject({ here: true })
  })

  it('returns to a former guardian', async () => {
    const away = await move()(token)
    const back = await move(alice, groupOf([x], 1))(away)
    expect(await x.tokenHead(back.state.token_id)).toMatchObject({ here: true })
    expect((await x.lines(1, 9)).map((l) => l.type)).toEqual(['creation', 'departure', 'arrival'])
  })

  it('needs the entry quorum of the new group', async () => {
    const next = await composeProposal(token, {
      signers: signersForState(alice, token.state),
      guardian: groupOf([y], 1),
      expiresIn: 3600,
      now: net.now,
    })
    await expect(x.validate(next)).rejects.toMatchObject({ code: 'INVALID_SIGNATURE' })
  })

  it('refuses bad entries', async () => {
    const stay = await composeProposal(token, {
      signers: signersForState(alice, token.state),
      expiresIn: 3600,
      now: net.now,
    })
    await expect(y.enter({ proposal: stay, previous: token })).rejects.toMatchObject({
      code: 'INVALID_FORMAT',
    })
    await expect(x.enter({ proposal: stay, previous: token })).rejects.toMatchObject({
      code: 'INVALID_FORMAT',
    })
    await expect(y.enter({ proposal: stay })).rejects.toMatchObject({ code: 'INVALID_FORMAT' })
    y.setPolicy({ creators: null, origins: [], maxProposalSeconds: 3600 })
    await expect(move()(token)).rejects.toMatchObject({ code: 'POLICY_REFUSED' })
  })

  it('respects allowed_guardians', async () => {
    const limited = await mint(net, alice, groupOf([x], 1), { allowed_guardians: [x.key] })
    await expect(move()(limited)).rejects.toMatchObject({ code: 'GUARDIAN_NOT_ALLOWED' })
  })

  it('refuses an old certificate and an unrelated guardian', async () => {
    const moved = await move()(token)
    await expect(y.certify({ token: token, previous: null })).rejects.toMatchObject({
      code: 'INVALID_FORMAT',
    })
    expect(await x.certify({ token: token, previous: null })).toEqual({ line: null })
    await expect(
      y.certify({
        token: {
          ...moved,
          signatures: { ...moved.signatures },
        },
        previous: null,
      }),
    ).resolves.toEqual({ line: null })
  })
})

describe('owner of several keys', () => {
  it('needs its threshold, and survives a lost key', async () => {
    const net = new Network()
    const [x] = (await guardians(net, ['x'])) as [Guardian]
    const group = groupOf([x], 1)
    const shared = newWallet(3, 2)
    const token = await mint(net, shared, group)
    const signers = signersForState(shared, token.state)
    expect(signers).toHaveLength(3)

    const alone = await composeProposal(token, {
      signers: signers.slice(0, 1),
      expiresIn: 3600,
      now: net.now,
    })
    await expect(commit(net.directory, alone, token)).rejects.toMatchObject({
      code: 'INVALID_SIGNATURE',
    })

    const replacement = newWallet(3, 2)
    const { keys, threshold } = directAddress(replacement)
    const rekey = await composeProposal(token, {
      signers: signers.slice(1),
      recipient: { owner: { keys, threshold } },
      expiresIn: 3600,
      now: net.now,
    })
    const accepted = await acceptProposal(
      rekey,
      signersForState(replacement, rekey.state).slice(0, 2),
    )
    const final = await commit(net.directory, accepted, token)
    expect(final.state.owner.keys).toEqual(keys)
  })

  it('counts one key once', async () => {
    const net = new Network()
    const [x] = (await guardians(net, ['x'])) as [Guardian]
    const shared = newWallet(2, 2)
    const token = await mint(net, shared, groupOf([x], 1))
    const [signer] = signersForState(shared, token.state)
    const next = await composeProposal(token, {
      signers: [signer, signer] as ReturnType<typeof signersForState>,
      expiresIn: 3600,
      now: net.now,
    })
    await expect(commit(net.directory, next, token)).rejects.toMatchObject({
      code: 'INVALID_SIGNATURE',
    })
  })
})

describe('createToken', () => {
  it('reports a missing quorum', async () => {
    const net = new Network()
    const group = groupOf(await guardians(net, ['a', 'b', 'c', 'd']), 3)
    const signer = generateSigner()
    const token = await composeToken({
      owner: soleOwner(signer.key),
      signers: [signer],
      subject: 'x',
      guardian: group,
    })
    net.down.add('https://a.test').add('https://b.test')
    await expect(createToken(net.directory, token)).rejects.toThrow('2 of 3 required answers')
  })
})
