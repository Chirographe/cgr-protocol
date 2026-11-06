import { p256 as curve } from '@noble/curves/nist.js'
import { describe, expect, it } from 'vitest'
import {
  algorithmOf,
  formatKey,
  hashFromBytes,
  hashOf,
  hashToBytes,
  isKnownKey,
  keyBytes,
  p256,
  sameValue,
  softwareSigner,
  stealthAlgorithmOf,
  supportsStealth,
  verifySignature,
  ZERO_HASH,
} from '../src/index.ts'
import { open, seal } from '../src/crypto/aead.ts'
import { decodeBase64Url, encodeBase64Url } from '../src/encoding/base64url.ts'
import { fromHex, toHex, utf8 } from '../src/encoding/bytes.ts'

describe('hash', () => {
  it('hashes the canonical form', () => {
    expect(hashOf({ b: 1, a: 2 })).toBe(hashOf({ a: 2, b: 1 }))
    expect(sameValue({ b: 1, a: 2 }, { a: 2, b: 1 })).toBe(true)
  })

  it('matches SHA-256 of the canonical text', () => {
    expect(hashOf({})).toBe(
      'sha256:44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a',
    )
  })

  it('converts to and from bytes', () => {
    expect(hashFromBytes(hashToBytes(ZERO_HASH))).toBe(ZERO_HASH)
  })
})

describe('p256', () => {
  // RFC 6979, appendix A.2.5, message "sample" with SHA-256.
  const secret = fromHex('c9afa9d845ba75166b5c215767b1d6934e50c3db36e89b127b8a622b120f6721')
  const expected =
    'efd48b2aacb6a8fd1140dd9cd45e81d69d2c877b56aaf991c34d0ea84eaf3716' +
    'f7cb1c942d657c41d436c7a1b6e29f65f3e900dbb9aff4064dc4ab2f843acda8'

  it('produces the deterministic signature of RFC 6979', () => {
    expect(toHex(p256.sign(utf8('sample'), secret))).toBe(expected)
  })

  it('verifies, and accepts high-S signatures', () => {
    expect(p256.verify(fromHex(expected), utf8('sample'), p256.publicKey(secret))).toBe(true)
    const s = BigInt(`0x${expected.slice(64)}`)
    expect(s > curve.Point.Fn.ORDER / 2n).toBe(true)
  })

  it('rejects tampering and malformed input', () => {
    const publicKey = p256.publicKey(secret)
    expect(p256.verify(fromHex(expected), utf8('other'), publicKey)).toBe(false)
    expect(p256.verify(new Uint8Array(10), utf8('sample'), publicKey)).toBe(false)
    expect(p256.verify(fromHex(expected), utf8('sample'), new Uint8Array(91))).toBe(false)
  })

  it('interoperates with WebCrypto in both directions', async () => {
    const spki = p256.publicKey(secret)
    const algorithm = { name: 'ECDSA', namedCurve: 'P-256', hash: 'SHA-256' }
    const key = await crypto.subtle.importKey('spki', spki, algorithm, true, ['verify'])
    expect(
      await crypto.subtle.verify(algorithm, key, p256.sign(utf8('m'), secret), utf8('m')),
    ).toBe(true)

    const pair = await crypto.subtle.generateKey(algorithm, true, ['sign', 'verify'])
    const signature = await crypto.subtle.sign(algorithm, pair.privateKey, utf8('m'))
    const exported = new Uint8Array(await crypto.subtle.exportKey('spki', pair.publicKey))
    expect(p256.verify(new Uint8Array(signature), utf8('m'), exported)).toBe(true)
  })

  it('keeps tweaked public and secret keys in step', () => {
    const tweak = p256.toTweak(new Uint8Array(32).fill(7)) as Uint8Array
    expect(p256.tweakPublicKey(p256.publicKey(secret), tweak)).toEqual(
      p256.publicKey(p256.tweakSecret(secret, tweak)),
    )
  })

  it('rejects a zero tweak', () => {
    expect(p256.toTweak(new Uint8Array(32))).toBeNull()
  })

  it('agrees on a shared secret', () => {
    const other = p256.generateSecret()
    expect(p256.sharedSecret(secret, p256.publicKey(other))).toEqual(
      p256.sharedSecret(other, p256.publicKey(secret)),
    )
  })
})

describe('keys', () => {
  const signer = softwareSigner(p256.generateSecret())

  it('routes by prefix', () => {
    expect(algorithmOf(signer.key)).toBe(p256)
    expect(stealthAlgorithmOf(signer.key)).toBe(p256)
    expect(supportsStealth(p256)).toBe(true)
    expect(formatKey(p256, keyBytes(signer.key))).toBe(signer.key)
  })

  it('rejects unknown prefixes', () => {
    expect(isKnownKey('nope:AAAA')).toBe(false)
    expect(isKnownKey('noprefix')).toBe(false)
    expect(() => algorithmOf('nope:AAAA')).toThrow('unknown key algorithm')
    expect(verifySignature('nope:AAAA', 'AAAA', utf8('m'))).toBe(false)
  })

  it('verifies a signature through the key', async () => {
    const signature = await signer.sign(utf8('m'))
    expect(verifySignature(signer.key, signature, utf8('m'))).toBe(true)
    expect(verifySignature(signer.key, signature, utf8('x'))).toBe(false)
    expect(verifySignature(signer.key, '***', utf8('m'))).toBe(false)
  })
})

describe('aead', () => {
  const key = new Uint8Array(32).fill(1)

  it('round-trips', () => {
    expect(open(key, seal(key, utf8('secret')))).toEqual(utf8('secret'))
  })

  it('rejects a modified ciphertext', () => {
    const sealed = seal(key, utf8('secret'))
    sealed[15] = (sealed[15] as number) ^ 1
    expect(() => open(key, sealed)).toThrow()
  })

  it('uses a fresh iv', () => {
    expect(encodeBase64Url(seal(key, utf8('x')))).not.toBe(encodeBase64Url(seal(key, utf8('x'))))
    expect(decodeBase64Url(encodeBase64Url(seal(key, utf8('x')))).length).toBe(12 + 1 + 16)
  })
})
