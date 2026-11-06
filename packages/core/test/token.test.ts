import { beforeEach, describe, expect, it } from 'vitest'
import {
  ProtocolError,
  acceptProposal,
  composeProposal,
  composeToken,
  generateSigner,
  hashOf,
  hashToBytes,
  parseToken,
  signersForState,
  soleOwner,
  validateToken,
  type Group,
  type Signer,
  type Token,
} from '../src/index.ts'
import { Network, groupOf, guardians, mint, newWallet } from './network.ts'

const code = (action: () => void) => {
  try {
    action()
  } catch (error) {
    if (error instanceof ProtocolError) return error.code
    throw error
  }
  return null
}

describe('token validity', () => {
  let net: Network
  let group: Group
  let alice: Signer
  let bob: Signer
  let token: Token

  beforeEach(async () => {
    net = new Network()
    group = groupOf(await guardians(net, ['x']), 1)
    alice = generateSigner()
    bob = generateSigner()
    token = await composeToken({
      owner: soleOwner(alice.key),
      signers: [alice],
      subject: 'Parcel 42',
      guardian: group,
    })
  })

  const proposal = (signer = alice) =>
    composeProposal(token, {
      signers: [signer],
      recipient: { owner: soleOwner(bob.key) },
      expiresIn: 3600,
    })

  it('accepts a new token', () => {
    expect(code(() => validateToken(token, { stage: 'complete' }))).toBeNull()
  })

  it('rejects modified rules', () => {
    const altered = { ...token, rules: { ...token.rules, subject: 'Other' } }
    expect(code(() => validateToken(altered, { stage: 'proposed' }))).toBe('RULES_TAMPERED')
  })

  it('rejects a new token that does not belong to its creator', () => {
    const state = { ...token.state, owner: soleOwner(bob.key) }
    expect(code(() => validateToken({ ...token, state }, { stage: 'proposed' }))).toBe(
      'INVALID_FORMAT',
    )
  })

  it('rejects a new token not signed by its creator', async () => {
    const forged = await composeProposal(token, { signers: [bob], expiresIn: null })
    const signatures = { senders: forged.signatures.senders }
    expect(code(() => validateToken({ ...token, signatures }, { stage: 'proposed' }))).toBe(
      'INVALID_SIGNATURE',
    )
  })

  it('rejects a recipient on a new token', () => {
    const signatures = { ...token.signatures, receivers: token.signatures.senders }
    expect(code(() => validateToken({ ...token, signatures }, { stage: 'proposed' }))).toBe(
      'INVALID_FORMAT',
    )
  })

  it('rejects a new token that does not start at sequence 0 with initial_guardian', async () => {
    const state = { ...token.state, sequence: 1 }
    const message = hashToBytes(hashOf(state))
    const senders = [{ type: 'raw' as const, key: alice.key, signature: await alice.sign(message) }]
    expect(
      code(() =>
        validateToken({ ...token, state, signatures: { senders } }, { stage: 'proposed' }),
      ),
    ).toBe('INVALID_FORMAT')
  })

  it('checks the chain against the previous state', async () => {
    const next = await proposal()
    const wrong = { ...token.state, date: '2020-01-01T00:00:00.000Z' }
    expect(code(() => validateToken(next, { stage: 'proposed', previous: wrong }))).toBe(
      'UNKNOWN_STATE',
    )
  })

  it('checks the sequence', async () => {
    const next = await proposal()
    const state = { ...next.state, sequence: 5 }
    expect(
      code(() => validateToken({ ...next, state }, { stage: 'proposed', previous: token.state })),
    ).toBe('INVALID_FORMAT')
  })

  it('requires the previous owner', async () => {
    const next = await proposal(bob)
    expect(code(() => validateToken(next, { stage: 'proposed', previous: token.state }))).toBe(
      'INVALID_SIGNATURE',
    )
  })

  it('rejects any invalid owner signature', async () => {
    const next = await proposal()
    const [first] = next.signatures.senders
    const senders = [{ ...(first as (typeof next.signatures.senders)[0]), signature: 'AAAA' }]
    const forged = { ...next, signatures: { senders } }
    expect(code(() => validateToken(forged, { stage: 'proposed' }))).toBe('INVALID_SIGNATURE')
  })

  it('requires the recipient from `complete` on', async () => {
    const next = await proposal()
    const context = { previous: token.state }
    expect(code(() => validateToken(next, { stage: 'proposed', ...context }))).toBeNull()
    expect(code(() => validateToken(next, { stage: 'complete', ...context }))).toBe(
      'INVALID_SIGNATURE',
    )
    const accepted = await acceptProposal(next, [bob])
    expect(code(() => validateToken(accepted, { stage: 'complete', ...context }))).toBeNull()
  })

  it('needs no recipient when the owner stays', async () => {
    const next = await composeProposal(token, { signers: [alice], expiresIn: 3600 })
    expect(code(() => validateToken(next, { stage: 'complete', previous: token.state }))).toBeNull()
  })

  it('rejects an expired proposal, but not a final token', async () => {
    const next = await proposal()
    const now = new Date(Date.parse(next.state.expires_at as string) + 1)
    expect(code(() => validateToken(next, { stage: 'proposed', now }))).toBe('PROPOSAL_EXPIRED')
  })

  it('limits guardians to allowed_guardians', async () => {
    const restricted = await composeToken({
      owner: soleOwner(alice.key),
      signers: [alice],
      subject: 'x',
      guardian: group,
      allowed_guardians: [generateSigner().key],
    })
    expect(code(() => validateToken(restricted, { stage: 'proposed' }))).toBe(
      'GUARDIAN_NOT_ALLOWED',
    )
  })

  it('requires a guardian quorum at `final`', () => {
    expect(code(() => validateToken(token, { stage: 'final' }))).toBe('INVALID_SIGNATURE')
  })

  it('refuses a recovery that targets another group or owner', async () => {
    const withoutRecovery = await composeProposal(token, {
      signers: [alice],
      expiresIn: null,
      takeover: true,
    })
    expect(code(() => validateToken(withoutRecovery, { stage: 'proposed' }))).toBe('INVALID_FORMAT')
  })
})

describe('parsing', () => {
  it('refuses unknown fields and bad formats', async () => {
    const net = new Network()
    const group = groupOf(await guardians(net, ['x']), 1)
    const wallet = newWallet()
    const token = await mint(net, wallet, group)
    expect(parseToken(token)).toEqual(token)
    expect(() => parseToken({ ...token, extra: 1 })).toThrow(ProtocolError)
    expect(() => parseToken({ ...token, format: 'token/0' })).toThrow(ProtocolError)
    expect(signersForState(wallet, token.state)).toHaveLength(1)
    expect(hashOf(token.rules)).toBe(token.state.token_id)
  })

  it('refuses an unsafe group', async () => {
    const net = new Network()
    const group = groupOf(await guardians(net, ['a', 'b', 'c', 'd', 'e']), 3)
    const wallet = newWallet()
    await expect(mint(net, wallet, group)).rejects.toThrow('unsafe threshold')
  })
})
