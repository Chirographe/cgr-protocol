import type { SignatureAlgorithm } from '../crypto/algorithm.ts'
import { DEFAULT_ALGORITHM, keyFromSecret, type Key } from '../crypto/keys.ts'
import { encodeBase64Url } from '../encoding/base64url.ts'

/**
 * Holds a private key. Implementations may live in a secure element or an HSM,
 * which is why signing is asynchronous and the secret is never exposed.
 */
export interface Signer {
  readonly key: Key
  sign(message: Uint8Array): Promise<string>
}

/** A signer whose secret lives in memory. */
export function softwareSigner(
  secret: Uint8Array,
  algorithm: SignatureAlgorithm = DEFAULT_ALGORITHM,
): Signer {
  return {
    key: keyFromSecret(secret, algorithm),
    sign: (message) => Promise.resolve(encodeBase64Url(algorithm.sign(message, secret))),
  }
}

export const generateSigner = (algorithm: SignatureAlgorithm = DEFAULT_ALGORITHM): Signer =>
  softwareSigner(algorithm.generateSecret(), algorithm)
