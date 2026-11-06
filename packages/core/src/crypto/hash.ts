import { sha256 } from '@noble/hashes/sha2.js'
import { fromHex, toHex, utf8 } from '../encoding/bytes.ts'
import { canonicalJson } from '../encoding/canonical.ts'

export type Hash = string

const PREFIX = 'sha256:'

export const ZERO_HASH: Hash = `${PREFIX}${'0'.repeat(64)}`

export { sha256 }

export const hashFromBytes = (bytes: Uint8Array): Hash => `${PREFIX}${toHex(bytes)}`

export const hashToBytes = (hash: Hash): Uint8Array => fromHex(hash.slice(PREFIX.length))

/** `H(x)` of the protocol. */
export const hashOf = (value: unknown): Hash => hashFromBytes(sha256(utf8(canonicalJson(value))))

export const sameValue = (a: unknown, b: unknown): boolean => hashOf(a) === hashOf(b)
