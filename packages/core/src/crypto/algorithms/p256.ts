import { p256 as curve } from '@noble/curves/nist.js'
import { concat, equalBytes, fromHex, toHex } from '../../encoding/bytes.ts'
import type { StealthAlgorithm } from '../algorithm.ts'

/** DER header of a P-256 SubjectPublicKeyInfo, followed by the 65-byte uncompressed point. */
const SPKI_HEADER = fromHex('3059301306072a8648ce3d020106082a8648ce3d030107034200')
const SIGNATURE_LENGTH = 64
const { Point } = curve
const { Fn } = Point

const toSpki = (point: Uint8Array): Uint8Array => concat(SPKI_HEADER, point)

function fromSpki(spki: Uint8Array): Uint8Array {
  const header = spki.subarray(0, SPKI_HEADER.length)
  if (spki.length !== SPKI_HEADER.length + 65 || !equalBytes(header, SPKI_HEADER)) {
    throw new Error('invalid P-256 public key')
  }
  return spki.subarray(SPKI_HEADER.length)
}

export const p256: StealthAlgorithm = {
  id: 'p256',

  generateSecret: () => curve.keygen().secretKey,

  publicKey: (secret) => toSpki(curve.getPublicKey(secret, false)),

  isPublicKey(publicKey) {
    try {
      Point.fromBytes(fromSpki(publicKey)).assertValidity()
      return true
    } catch {
      return false
    }
  },

  sign: (message, secret) => curve.sign(message, secret, { prehash: true, lowS: false }),

  verify(signature, message, publicKey) {
    if (signature.length !== SIGNATURE_LENGTH) return false
    try {
      // Hardware keys do not normalize s, so high-S signatures stay valid.
      return curve.verify(signature, message, fromSpki(publicKey), { prehash: true, lowS: false })
    } catch {
      return false
    }
  },

  sharedSecret: (secret, publicKey) =>
    curve.getSharedSecret(secret, fromSpki(publicKey), true).subarray(1),

  toTweak(digest) {
    const value = Fn.create(BigInt(`0x${toHex(digest)}`))
    return value === 0n ? null : Fn.toBytes(value)
  },

  tweakPublicKey(publicKey, tweak) {
    const point = Point.fromBytes(fromSpki(publicKey))
    return toSpki(point.add(Point.BASE.multiply(Fn.fromBytes(tweak))).toBytes(false))
  },

  tweakSecret: (secret, tweak) => Fn.toBytes(Fn.add(Fn.fromBytes(secret), Fn.fromBytes(tweak))),
}
