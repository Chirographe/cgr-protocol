import { ed25519 } from '@noble/curves/ed25519.js'
import { describe, expect, it } from 'vitest'
import {
  generateSigner,
  isKnownKey,
  payTo,
  predicates,
  registerAlgorithm,
  formatKey,
  type SignatureAlgorithm,
} from '../src/index.ts'
import { Network } from './support/network.ts'
import { mint, transfer } from './support/tokens.ts'

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

  it('runs owners and guardians on another algorithm, side by side with p256', async () => {
    registerAlgorithm(ed)
    const net = new Network()
    const guardians = [await net.add('e', ed), await net.add('p')]
    const group = { members: guardians.map((g) => ({ key: g.key, url: g.url })), threshold: 2 }
    const [alice, bob] = [generateSigner(ed), generateSigner()]
    const minted = await mint(net, { group, owner: alice })
    const moved = await transfer(net, minted, [alice], { lock: predicates.sig(bob.key) })
    expect(moved.output.sequence).toBe(1)
  })

  it('refuses stealth on an algorithm that lacks it', () => {
    registerAlgorithm(ed)
    const key = formatKey(ed, ed.publicKey(ed.generateSecret()))
    const address = {
      scan: key,
      keys: [key],
      threshold: 1,
      relay: 'https://relay.test',
      stealth: true,
    }
    expect(() => payTo([address])).toThrow()
  })
})
