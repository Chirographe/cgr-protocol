import { ed25519 } from '@noble/curves/ed25519.js'
import { describe, expect, it } from 'vitest'
import {
  acceptProposal,
  commit,
  composeProposal,
  composeToken,
  createToken,
  formatKey,
  generateSigner,
  isKnownKey,
  p256,
  parseToken,
  registerAlgorithm,
  soleOwner,
  stealthAlgorithmOf,
  validateToken,
  type SignatureAlgorithm,
} from '../src/index.ts'
import { Network, groupOf } from './network.ts'

/** A second scheme, written in one place: nothing else in the library changes. */
const ed: SignatureAlgorithm = {
  id: 'ed25519',
  generateSecret: () => ed25519.utils.randomSecretKey(),
  isPublicKey: (publicKey) => publicKey.length === 32,
  publicKey: (secret) => ed25519.getPublicKey(secret),
  sign: (message, secret) => ed25519.sign(message, secret),
  verify: (signature, message, publicKey) => ed25519.verify(signature, message, publicKey),
}

describe('algorithm agility', () => {
  it('rejects a key until its algorithm is registered', () => {
    const key = formatKey(ed, ed.publicKey(ed.generateSecret()))
    expect(isKnownKey(key)).toBe(false)
    registerAlgorithm(ed)
    expect(isKnownKey(key)).toBe(true)
  })

  it('runs the whole protocol on another algorithm', async () => {
    registerAlgorithm(ed)
    const net = new Network()
    const x = await net.add('x', ed)
    const alice = generateSigner(ed)
    const bob = generateSigner(ed)
    expect(x.key.startsWith('ed25519:')).toBe(true)

    const token = await createToken(
      net.directory,
      await composeToken({
        owner: soleOwner(alice.key),
        signers: [alice],
        subject: 'Parcel 42',
        guardian: groupOf([x], 1),
        now: net.now,
      }),
    )
    const proposal = await composeProposal(token, {
      signers: [alice],
      recipient: { owner: soleOwner(bob.key) },
      expiresIn: 3600,
      now: net.now,
    })
    const final = await commit(net.directory, await acceptProposal(proposal, [bob]), token)
    expect(() => validateToken(parseToken(final), { stage: 'final' })).not.toThrow()
  })

  it('moves a token and a guardian to a new algorithm', async () => {
    registerAlgorithm(ed)
    const net = new Network()
    const x = await net.add('x', p256)
    const alice = generateSigner(p256)
    const token = await createToken(
      net.directory,
      await composeToken({
        owner: soleOwner(alice.key),
        signers: [alice],
        subject: 'x',
        guardian: groupOf([x], 1),
        now: net.now,
      }),
    )
    const future = generateSigner(ed)
    const proposal = await composeProposal(token, {
      signers: [alice],
      recipient: { owner: soleOwner(future.key) },
      expiresIn: 3600,
      now: net.now,
    })
    const final = await commit(net.directory, await acceptProposal(proposal, [future]), token)
    expect(final.state.owner.keys[0]?.startsWith('ed25519:')).toBe(true)
  })

  it('refuses stealth on an algorithm that lacks it', () => {
    registerAlgorithm(ed)
    const key = formatKey(ed, ed.publicKey(ed.generateSecret()))
    expect(() => stealthAlgorithmOf(key)).toThrow('no stealth support')
  })
})
