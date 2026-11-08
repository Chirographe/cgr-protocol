import { describe, expect, it } from 'vitest'
import {
  HttpGuardian,
  ProtocolError,
  bodyHash,
  checkLedger,
  checkVoteLine,
  hashLine,
  ledgerRoot,
  commit,
  composeTransition,
  encodeBase64Url,
  generateSigner,
  generateWallet,
  hashToBytes,
  holdsAnyKey,
  isKnownKey,
  isOwnLock,
  p256,
  payTo,
  predicates,
  scanOwners,
  signTransition,
  spendOf,
  validateTransition,
  continueOutput,
  walletAddress,
  withVotes,
  type GuardianApi,
  type Transition,
} from '../src/index.ts'
import { Network } from './support/network.ts'
import { heldAt, mint, move, people } from './support/tokens.ts'

const { sig, keys } = predicates
const { alice, bob, mallory } = people('alice', 'bob', 'mallory')

const refused = (promise: Promise<unknown>, code: string) =>
  expect(promise).rejects.toSatisfy((e) => e instanceof ProtocolError && e.code === code)

describe('a server that a wallet logs in to', () => {
  it('cannot turn a login into evidence for a transition', async () => {
    const net = new Network()
    const group = await net.group(['x'], 1)
    const minted = await mint(net, { group, owner: alice! })
    const theft = composeTransition({
      group,
      inputs: [spendOf(minted.output)],
      outputs: [continueOutput(minted.output, { lock: sig(mallory!.key) })],
    })
    let signature = ''
    const rogue = new HttpGuardian('https://rogue.test', {
      fetch: (url, init) => {
        if (url.endsWith('/auth/challenge')) {
          const challenge = encodeBase64Url(hashToBytes(bodyHash(theft)))
          return Promise.resolve(new Response(JSON.stringify({ challenge })))
        }
        ;({ signature } = JSON.parse(init.body as string) as { signature: string })
        return Promise.resolve(new Response(JSON.stringify({ session: 'x' })))
      },
    })
    await rogue.authenticate(alice!)
    const forged: Transition = {
      ...theft,
      evidence: {
        signatures: [{ type: 'raw', key: alice!.key, signature }],
        preimages: [],
        proofs: [],
      },
    }
    await refused(commit(net.directory, forged, [minted.transition]), 'NOT_AUTHORIZED')
  })
})

describe('a forger', () => {
  it('cannot pass off votes of keys outside the group', async () => {
    const net = new Network()
    const group = await net.group(['x', 'y', 'z', 'w'], 3)
    const minted = await mint(net, { group, owner: alice! })
    const fake = await net.group(['f'], 1)
    const proposal = await move(minted, [alice!], { lock: sig(bob!.key) })
    const foreignVotes =
      (await net
        .directory(fake.members[0]!.url)
        .validate({ transition: proposal, previous: [] })
        .catch(() => null)) ?? proposal
    const forged = withVotes(proposal, foreignVotes.guardians ?? [])
    await refused(
      net
        .directory(group.members[0]!.url)
        .certify({ transition: forged, previous: [minted.transition] }),
      'NOT_AUTHORIZED',
    )
  })

  it('cannot start a token in the name of an issuer', async () => {
    const net = new Network()
    const group = await net.group(['x'], 1)
    const registry = generateSigner()
    await refused(
      mint(net, { group, owner: mallory!, issuer: mallory!, issuerPredicate: sig(registry.key) }),
      'NOT_AUTHORIZED',
    )
  })

  it('cannot start an existing token again to escape its covenant', async () => {
    const net = new Network()
    const group = await net.group(['x'], 1)
    const minted = await mint(net, { group, owner: alice!, covenant: [{ accept: true }] })
    const restart = composeTransition({
      group,
      outputs: [{ ...minted.output, lock: sig(mallory!.key) }],
    })
    await refused(validateTransition(restart, [], 'authorized', net.now), 'NOT_AUTHORIZED')
    await refused(
      commit(net.directory, await signTransition(restart, [alice!]), []),
      'ALREADY_SPENT',
    )
  })

  it('cannot take a token over from a group that is not its recovery group', async () => {
    const net = new Network()
    const group = await net.group(['x'], 1)
    const rescue = await net.group(['r'], 1)
    const other = await net.group(['o'], 1)
    const minted = await mint(net, {
      group,
      owner: alice!,
      recovery: { group: rescue, delay_seconds: 1 },
    })
    const grab = await move(minted, [alice!], { group: other }, other)
    await refused(
      validateTransition(grab, [minted.transition], 'authorized', net.now),
      'NOT_AUTHORIZED',
    )
    await refused(commit(net.directory, grab, [minted.transition]), 'UNKNOWN')
  })

  it('cannot bring a second copy of a token into the group that holds it', async () => {
    const net = new Network()
    const group = await net.group(['x'], 1)
    const elsewhere = await net.group(['e'], 1)
    const minted = await mint(net, { group, owner: alice! })
    const copy = heldAt({
      ...minted.transition,
      body: { ...minted.transition.body, group: elsewhere },
    })
    const back = await move(copy, [alice!], { group }, elsewhere)
    await refused(commit(net.directory, back, [copy.transition]), 'NOT_AUTHORIZED')
  })
})

describe('a recipient', () => {
  it('does not take a lock that another key can open for its own', () => {
    const wallet = generateWallet(p256)
    const { locks, ephemeral } = payTo([walletAddress(wallet, 'https://relay.test')])
    const lock = locks[0]!
    expect(isOwnLock(wallet, lock, ephemeral)).toBe(true)
    const shared = predicates.any(lock, sig(mallory!.key))
    expect(isOwnLock(wallet, shared, ephemeral)).toBe(false)
  })

  it('does not accept a lower threshold than its own', () => {
    const wallet = generateWallet(p256, 2, 2)
    const address = walletAddress(wallet, 'https://relay.test', false)
    expect(isOwnLock(wallet, keys(1, address.keys))).toBe(false)
    expect(isOwnLock(wallet, keys(2, address.keys))).toBe(true)
  })
})

describe('a wallet', () => {
  it('survives a malformed ephemeral in the list of owners', async () => {
    const wallet = generateWallet(p256)
    const address = walletAddress(wallet, 'https://relay.test', false)
    const guardian = {
      owners: () => Promise.resolve([{ n: 1, ephemeral: 'p256:AAAA', keys: ['p256:BBBB'] }]),
    } as unknown as GuardianApi
    await expect(scanOwners(guardian, (k, e) => holdsAnyKey(wallet, k, e))).resolves.toEqual([])
    expect(holdsAnyKey(wallet, address.keys, 'p256:AAAA')).toBe(true)
  })

  it('does not take a notice line for the record of a transition', async () => {
    const hash = bodyHash(
      composeTransition({ group: { members: [], threshold: 1 } as never, outputs: [] }),
    )
    const notice = {
      n: 1,
      type: 'notice' as const,
      hash,
      spent: [],
      date: '2026-11-06T12:00:00.000Z',
    }
    const head = {
      n: 1,
      root: ledgerRoot([hashLine(notice)]),
      date: notice.date,
      signature: 'AAAA',
    }
    const guardian = {
      lines: () => Promise.resolve([notice]),
      inclusionProof: () => Promise.resolve([]),
    } as unknown as GuardianApi
    const vote = {
      type: 'raw' as const,
      key: alice!.key,
      signature: 'AAAA',
      line: 1,
      line_hash: hashLine(notice),
    }
    expect(await checkVoteLine(guardian, hash, vote, head)).toBe(false)
    const recorded = { ...notice, type: 'transition' as const }
    const honest = {
      lines: () => Promise.resolve([recorded]),
      inclusionProof: () => Promise.resolve([]),
    } as unknown as GuardianApi
    const fair = { ...vote, line_hash: hashLine(recorded) }
    expect(
      await checkVoteLine(honest, hash, fair, { ...head, root: ledgerRoot([hashLine(recorded)]) }),
    ).toBe(true)
  })

  it('treats any explicit lock of a head as a lock', async () => {
    const net = new Network()
    await net.group(['x'], 1)
    const x = net.node('x').guardian
    const head = await x.head()
    const lying = { head: () => Promise.resolve({ ...head, locked: false }) } as GuardianApi
    expect(await checkLedger(lying, x.key, null)).toMatchObject({ ok: false })
  })
})

describe('keys', () => {
  it('reject what is not a point on the curve', () => {
    expect(isKnownKey('p256:AAAA')).toBe(false)
    const valid = generateSigner().key
    expect(isKnownKey(valid)).toBe(true)
    const flipped = `${valid.slice(0, 40)}${valid[40] === 'A' ? 'B' : 'A'}${valid.slice(41)}`
    expect(isKnownKey(flipped)).toBe(false)
  })

  it('have one spelling only', () => {
    const valid = generateSigner().key
    const last = valid.at(-1) as string
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'
    const alias = `${valid.slice(0, -1)}${alphabet[alphabet.indexOf(last) + 1] ?? 'A'}`
    expect(isKnownKey(alias)).toBe(false)
  })
})
