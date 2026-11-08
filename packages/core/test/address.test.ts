import { describe, expect, it } from 'vitest'
import {
  decodeAddress,
  encodeAddress,
  generateWallet,
  holdsAnyKey,
  isOwnLock,
  openMessage,
  p256,
  payTo,
  predicateKeys,
  sealMessage,
  signersFor,
  walletAddress,
} from '../src/index.ts'

const RELAY = 'https://relay.test'

describe('addresses', () => {
  it('round-trips the text form', () => {
    const address = walletAddress(generateWallet(p256, 2, 2), RELAY)
    expect(decodeAddress(encodeAddress(address))).toEqual(address)
    expect(() => decodeAddress('nope')).toThrow()
  })

  it('derives one-time keys that only the recipient can sign with', () => {
    const wallet = generateWallet(p256, 2, 2)
    const address = walletAddress(wallet, RELAY)
    const { locks, ephemeral } = payTo([address])
    const lock = locks[0]!
    const keys = predicateKeys(lock)
    expect(keys).not.toContain(address.keys[0])
    expect(signersFor(wallet, keys, ephemeral).map((s) => s.key)).toEqual(keys)
    expect(isOwnLock(wallet, lock, ephemeral)).toBe(true)
    const stranger = generateWallet(p256)
    expect(holdsAnyKey(stranger, keys, ephemeral)).toBe(false)
  })

  it('pays several addresses with one ephemeral', () => {
    const [a, b] = [generateWallet(p256), generateWallet(p256)]
    const { locks, ephemeral } = payTo([walletAddress(a, RELAY), walletAddress(b, RELAY, false)])
    expect(isOwnLock(a, locks[0]!, ephemeral)).toBe(true)
    expect(isOwnLock(b, locks[1]!, ephemeral)).toBe(true)
    expect(isOwnLock(a, locks[1]!, ephemeral)).toBe(false)
  })

  it('uses plain keys without stealth', () => {
    const wallet = generateWallet(p256)
    const address = walletAddress(wallet, RELAY, false)
    const { locks, ephemeral } = payTo([address])
    expect(ephemeral).toBeUndefined()
    expect(predicateKeys(locks[0]!)).toEqual(address.keys)
    expect(isOwnLock(wallet, locks[0]!)).toBe(true)
  })

  it('encrypts relay messages to the scan key', () => {
    const wallet = generateWallet(p256)
    const address = walletAddress(wallet, RELAY)
    const refusal = { refused: `sha256:${'0'.repeat(64)}`, reason: 'no thanks' }
    const message = sealMessage(address.scan, refusal)
    expect(openMessage(wallet, message)).toEqual(refusal)
    expect(() => openMessage(generateWallet(p256), message)).toThrow()
  })
})
