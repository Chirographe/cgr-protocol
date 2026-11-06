import { beforeEach, describe, expect, it } from 'vitest'
import {
  Guardian,
  Mailboxes,
  Sessions,
  acceptProposal,
  canAccept,
  commit,
  composeProposal,
  decodeAddress,
  deriveOwner,
  encodeAddress,
  generateSigner,
  hashOf,
  inspectEnvelope,
  openMessage,
  owns,
  scanOwners,
  sealMessage,
  signersFor,
  signersForState,
  validateToken,
  walletAddress,
  type Check,
  type Envelope,
  type Group,
  type Head,
  type RecipientContext,
  type Token,
  type Wallet,
} from '../src/index.ts'
import {
  Network,
  directAddress,
  groupOf,
  guardians,
  mint,
  newWallet,
  stealthAddress,
} from './network.ts'
import { decodeBase64Url } from '../src/encoding/base64url.ts'
import { utf8 } from '../src/encoding/bytes.ts'

describe('address', () => {
  it('round-trips', () => {
    const address = stealthAddress(newWallet(3, 2))
    const text = encodeAddress(address)
    expect(text.startsWith('cgr:')).toBe(true)
    expect(decodeAddress(text)).toEqual(address)
  })

  it('refuses malformed input', () => {
    expect(() => decodeAddress('nope')).toThrow('invalid address')
  })
})

describe('one-time owners', () => {
  it('gives a different owner each time, that only the recipient holds', () => {
    const bob = newWallet()
    const address = stealthAddress(bob)
    const first = deriveOwner(address)
    const second = deriveOwner(address)
    expect(first.owner.keys).not.toEqual(second.owner.keys)
    expect(first.owner.keys).not.toEqual(address.keys)
    expect(owns(bob, first.owner, first.ephemeral)).toBe(true)
    expect(owns(newWallet(), first.owner, first.ephemeral)).toBe(false)
  })

  it('produces keys that really sign', async () => {
    const bob = newWallet(2, 2)
    const { owner, ephemeral } = deriveOwner(stealthAddress(bob))
    const signers = signersFor(bob, owner, ephemeral)
    expect(signers.map((s) => s.key)).toEqual(owner.keys)
    expect(await signers[0]?.sign(utf8('m'))).toBeTruthy()
  })

  it('keeps plain keys when the address is not stealth', () => {
    const bob = newWallet()
    const derived = deriveOwner(directAddress(bob))
    expect(derived.ephemeral).toBeUndefined()
    expect(owns(bob, derived.owner)).toBe(true)
  })
})

describe('relay encryption', () => {
  it('only the recipient reads a message', async () => {
    const net = new Network()
    const [x] = (await guardians(net, ['x'])) as [Guardian]
    const alice = newWallet()
    const token = await mint(net, alice, groupOf([x], 1))
    const bob = newWallet()
    const message = sealMessage(stealthAddress(bob).scan, token)

    expect(openMessage(bob, message)).toEqual(token)
    expect(() => openMessage(newWallet(), message)).toThrow()
    expect(new TextDecoder().decode(decodeBase64Url(message.ciphertext))).not.toContain('Parcel')
  })
})

describe('a stealth transfer through the relay', () => {
  let net: Network
  let x: Guardian
  let group: Group
  let alice: Wallet
  let bob: Wallet
  let token: Token
  let mailboxes: Mailboxes
  let context: RecipientContext

  beforeEach(async () => {
    net = new Network()
    ;[x] = (await guardians(net, ['x'])) as [Guardian]
    group = groupOf([x], 1)
    alice = newWallet()
    bob = newWallet()
    token = await mint(net, alice, group)
    mailboxes = new Mailboxes(net.clock)
    context = {
      directory: net.directory,
      trustOf: () => 'trusted',
      lastSeen: new Map<string, Head>(),
      now: net.now,
    }
  })

  const send = async (): Promise<Envelope> => {
    const address = stealthAddress(bob)
    const proposal = await composeProposal(token, {
      signers: signersForState(alice, token.state),
      recipient: deriveOwner(address),
      expiresIn: 3600,
      now: net.now,
    })
    const from = walletAddress(alice, 'https://relay.test')
    mailboxes.deposit(address.scan, sealMessage(address.scan, { from, proposal, previous: token }))
    const [stored] = mailboxes.list(address.scan)
    return openMessage(bob, stored?.content as NonNullable<typeof stored>['content']) as Envelope
  }

  const failing = (checks: Check[]) => checks.filter((c) => !c.ok).map((c) => c.name)

  it('goes through and hides the recipient', async () => {
    const envelope = await send()
    const checks = await inspectEnvelope(envelope, bob, context)
    expect(failing(checks)).toEqual([])
    expect(canAccept(checks)).toBe(true)

    const { proposal, previous } = envelope
    const accepted = await acceptProposal(proposal, signersForState(bob, proposal.state))
    const final = await commit(net.directory, accepted, previous)
    expect(() => validateToken(final, { stage: 'final', previous: token.state })).not.toThrow()
    expect(final.state.owner.keys).not.toContain(stealthAddress(bob).keys[0])
  })

  it('refuses what is not addressed to the recipient', async () => {
    const envelope = await send()
    const checks = await inspectEnvelope(envelope, newWallet(), context)
    expect(failing(checks)).toEqual(['mine'])
    expect(canAccept(checks)).toBe(false)
  })

  it('refuses an expired proposal', async () => {
    const envelope = await send()
    const later = new Date(net.now.getTime() + 7200_000)
    const checks = await inspectEnvelope(envelope, bob, { ...context, now: later })
    expect(failing(checks)).toEqual(['not-expired'])
  })

  it('refuses a state already spent', async () => {
    const envelope = await send()
    const cancel = await composeProposal(token, {
      signers: signersForState(alice, token.state),
      expiresIn: 3600,
      now: net.now,
    })
    await commit(net.directory, cancel, token)
    expect(failing(await inspectEnvelope(envelope, bob, context))).toContain('unspent')
  })

  it('refuses a blocked guardian, and warns about an unknown one', async () => {
    const envelope = await send()
    const blocked = await inspectEnvelope(envelope, bob, { ...context, trustOf: () => 'blocked' })
    expect(canAccept(blocked)).toBe(false)
    const unknown = await inspectEnvelope(envelope, bob, { ...context, trustOf: () => 'unknown' })
    expect(failing(unknown)).toEqual(['guardians-trusted'])
    expect(canAccept(unknown)).toBe(true)
  })

  it('refuses a forged previous token', async () => {
    const envelope = await send()
    const forged = {
      ...envelope,
      previous: { ...envelope.previous, signatures: envelope.proposal.signatures },
    }
    const checks = await inspectEnvelope(forged, bob, context)
    expect(failing(checks)).toContain('previous-final')
  })

  it('warns about a rewritten ledger', async () => {
    const envelope = await send()
    await inspectEnvelope(envelope, bob, context)
    const stored = context.lastSeen.get(x.url) as Head
    context.lastSeen.set(x.url, { ...stored, root: envelope.proposal.state.token_id, n: 1 })
    const checks = await inspectEnvelope(envelope, bob, context)
    expect(failing(checks)).toEqual(['ledger'])
    expect(canAccept(checks)).toBe(true)
  })

  it('warns when a guardian cannot be reached for the ledger check', async () => {
    const envelope = await send()
    net.down.add(x.url)
    const checks = await inspectEnvelope(envelope, bob, context)
    expect(failing(checks)).toEqual(['unspent', 'ledger'])
  })
})

describe('recovery of an announced token by the recipient', () => {
  it('refuses a token under recovery', async () => {
    const net = new Network()
    const members = await guardians(net, ['x', 'r'])
    const [x, r] = members as [Guardian, Guardian]
    const alice = newWallet()
    const bob = newWallet()
    const token = await mint(net, alice, groupOf([x], 1), {
      recovery: { group: groupOf([r], 1), delay_seconds: 60 },
    })
    const recovery = await composeProposal(token, {
      signers: signersForState(alice, token.state),
      guardian: groupOf([r], 1),
      expiresIn: null,
      takeover: true,
      now: net.now,
    })
    await r.requestRecovery({ proposal: recovery, previous: token })

    const proposal = await composeProposal(token, {
      signers: signersForState(alice, token.state),
      recipient: deriveOwner(stealthAddress(bob)),
      expiresIn: 3600,
      now: net.now,
    })
    const envelope = { from: stealthAddress(alice), proposal, previous: token }
    const checks = await inspectEnvelope(envelope, bob, {
      directory: net.directory,
      trustOf: () => 'trusted',
      lastSeen: new Map(),
      now: net.now,
    })
    expect(checks.find((c) => c.name === 'no-recovery')?.ok).toBe(false)
  })
})

describe('wallet recovery', () => {
  it('finds tokens from private keys alone', async () => {
    const net = new Network()
    const [x] = (await guardians(net, ['x'])) as [Guardian]
    const alice = newWallet()
    const bob = newWallet()
    const token = await mint(net, alice, groupOf([x], 1))
    await mint(net, newWallet(), groupOf([x], 1))
    const proposal = await composeProposal(token, {
      signers: signersForState(alice, token.state),
      recipient: deriveOwner(stealthAddress(bob)),
      expiresIn: 3600,
      now: net.now,
    })
    await commit(
      net.directory,
      await acceptProposal(proposal, signersForState(bob, proposal.state)),
      token,
    )
    const found = await scanOwners(x, bob)
    expect(found).toHaveLength(1)
    expect(found[0]?.ephemeral).toBe(proposal.state.ephemeral)
    expect(await scanOwners(x, newWallet())).toHaveLength(0)

    const [key] = found[0]?.owner.keys ?? []
    expect(await x.tokensOf(key as string)).toHaveLength(1)
  })
})

describe('relay and sessions', () => {
  it('authenticates a key holder', async () => {
    const net = new Network()
    const sessions = new Sessions(net.clock)
    const signer = generateSigner()
    const { challenge } = sessions.challenge(signer.key)
    const signature = await signer.sign(decodeBase64Url(challenge))
    const { session } = sessions.respond({ key: signer.key, challenge, signature })
    expect(() => sessions.require(session, signer.key)).not.toThrow()
    expect(() => sessions.require(session, generateSigner().key)).toThrow()
    expect(() => sessions.require(undefined, signer.key)).toThrow()
    net.advance(3601)
    expect(() => sessions.require(session, signer.key)).toThrow()
  })

  it('refuses a replayed, expired or forged answer', async () => {
    const net = new Network()
    const sessions = new Sessions(net.clock)
    const signer = generateSigner()
    const { challenge } = sessions.challenge(signer.key)
    const signature = await signer.sign(decodeBase64Url(challenge))
    sessions.respond({ key: signer.key, challenge, signature })
    expect(() => sessions.respond({ key: signer.key, challenge, signature })).toThrow()

    const other = sessions.challenge(signer.key)
    net.advance(121)
    const late = await signer.sign(decodeBase64Url(other.challenge))
    expect(() =>
      sessions.respond({ key: signer.key, challenge: other.challenge, signature: late }),
    ).toThrow()

    const third = sessions.challenge(signer.key)
    expect(() =>
      sessions.respond({ key: signer.key, challenge: third.challenge, signature: late }),
    ).toThrow()
  })

  it('carries refusals', () => {
    const bob = newWallet()
    const refusal = { refused: hashOf('state'), reason: 'too expensive', requested_guardian: null }
    const message = sealMessage(stealthAddress(bob).scan, refusal)
    expect(openMessage(bob, message)).toEqual(refusal)
  })

  it('stores encrypted messages only', () => {
    const boxes = new Mailboxes()
    const scan = generateSigner().key
    expect(() => boxes.deposit(scan, { clear: 'text' })).toThrow()
    const { id } = boxes.deposit(scan, { ephemeral: scan, ciphertext: 'AAAA' })
    expect(boxes.list(scan)).toHaveLength(1)
    boxes.remove(scan, id)
    expect(boxes.list(scan)).toHaveLength(0)
  })
})
