import { decodeBase64Url, encodeBase64Url } from '../encoding/base64url.ts'
import { supportsStealth, type SignatureAlgorithm, type StealthAlgorithm } from './algorithm.ts'
import { p256 } from './algorithms/p256.ts'

export type Key = string

/** Supported algorithms. A new one is a new `SignatureAlgorithm` and a new entry here. */
const algorithms = new Map<string, SignatureAlgorithm>([[p256.id, p256]])

export const DEFAULT_ALGORITHM: StealthAlgorithm = p256

export function registerAlgorithm(algorithm: SignatureAlgorithm): void {
  algorithms.set(algorithm.id, algorithm)
}

function split(key: Key): { algorithm: SignatureAlgorithm; bytes: Uint8Array } {
  const separator = key.indexOf(':')
  const algorithm = algorithms.get(key.slice(0, separator))
  if (separator < 0 || !algorithm) throw new Error(`unknown key algorithm: ${key.slice(0, 16)}`)
  return { algorithm, bytes: decodeBase64Url(key.slice(separator + 1)) }
}

export const formatKey = (algorithm: SignatureAlgorithm, publicKey: Uint8Array): Key =>
  `${algorithm.id}:${encodeBase64Url(publicKey)}`

export const keyBytes = (key: Key): Uint8Array => split(key).bytes

export const algorithmOf = (key: Key): SignatureAlgorithm => split(key).algorithm

export function stealthAlgorithmOf(key: Key): StealthAlgorithm {
  const algorithm = algorithmOf(key)
  if (!supportsStealth(algorithm)) throw new Error(`${algorithm.id} has no stealth support`)
  return algorithm
}

/** One spelling per key: base64url has spare bits, and a key must not pass for two. */
export function isKnownKey(key: Key): boolean {
  try {
    const { algorithm, bytes } = split(key)
    return algorithm.isPublicKey(bytes) && formatKey(algorithm, bytes) === key
  } catch {
    return false
  }
}

export function keyFromSecret(secret: Uint8Array, algorithm: SignatureAlgorithm): Key {
  return formatKey(algorithm, algorithm.publicKey(secret))
}

/** Verifies a `raw` signature with the algorithm named by the key. */
export function verifySignature(key: Key, signature: string, message: Uint8Array): boolean {
  try {
    const { algorithm, bytes } = split(key)
    return algorithm.verify(decodeBase64Url(signature), message, bytes)
  } catch {
    return false
  }
}
