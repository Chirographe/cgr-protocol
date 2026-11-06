import type { SignatureAlgorithm } from '../crypto/algorithm.ts'
import { DEFAULT_ALGORITHM } from '../crypto/keys.ts'
import { generateSigner, type Signer } from '../signing/signer.ts'

/** Holds the guardian key. An HSM or a KMS implements this. */
export interface Keyring {
  current(): Signer
  /** Prepares the next key without activating it. May use another algorithm. */
  next(): Promise<Signer>
  activate(signer: Signer): Promise<void>
}

export function memoryKeyring(algorithm: SignatureAlgorithm = DEFAULT_ALGORITHM): Keyring {
  let signer = generateSigner(algorithm)
  return {
    current: () => signer,
    next: () => Promise.resolve(generateSigner(algorithm)),
    activate(next) {
      signer = next
      return Promise.resolve()
    },
  }
}
