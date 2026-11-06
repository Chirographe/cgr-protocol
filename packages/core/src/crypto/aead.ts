import { gcm } from '@noble/ciphers/aes.js'
import { concat, randomBytes } from '../encoding/bytes.ts'

const IV_LENGTH = 12

/** AES-256-GCM. Output is `iv ‖ ciphertext ‖ tag`. */
export function seal(key: Uint8Array, plaintext: Uint8Array): Uint8Array {
  const iv = randomBytes(IV_LENGTH)
  return concat(iv, gcm(key, iv).encrypt(plaintext))
}

export function open(key: Uint8Array, sealed: Uint8Array): Uint8Array {
  return gcm(key, sealed.subarray(0, IV_LENGTH)).decrypt(sealed.subarray(IV_LENGTH))
}
