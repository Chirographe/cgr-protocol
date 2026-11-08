import { FORMAT } from '../constants.ts'
import { utf8 } from '../encoding/bytes.ts'
import { hashToBytes, type Hash } from '../crypto/hash.ts'
import type { Key } from '../crypto/keys.ts'

const message = (...parts: (string | number)[]): Uint8Array => utf8([FORMAT, ...parts].join('|'))

/** What every piece of evidence signs: the 32 bytes of `H(body)`. */
export const evidenceMessage = (bodyHash: Hash): Uint8Array => hashToBytes(bodyHash)

export const guardianMessage = (bodyHash: Hash, line: number, lineHash: Hash): Uint8Array =>
  message('guardian', bodyHash, line, lineHash)

export const entryMessage = (bodyHash: Hash): Uint8Array => message('entry', bodyHash)

/** Never the bare challenge: a server could pass off the hash of a body as one. */
export const sessionMessage = (challenge: string): Uint8Array => message('session', challenge)

export const headMessage = (n: number, root: Hash): Uint8Array => message('head', n, root)

export const rotationMessage = (previous: Key, next: Key): Uint8Array =>
  message('rotation', previous, next)

export const witnessMessage = (guardian: Key, n: number, root: Hash): Uint8Array =>
  message('witness', guardian, n, root)
