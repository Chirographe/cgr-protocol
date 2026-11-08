import { hashToBytes, toHex, type Hash } from '@chirographe/core'
import type { Identity } from '@semaphore-protocol/identity'
import { keccak_256 } from '@noble/hashes/sha3.js'
import { poseidon2 } from 'poseidon-lite'

/** Semaphore's `hash`: keccak-256 of the 32-byte value, shifted into the SNARK field. */
const fieldHash = (hash: Hash): bigint => BigInt(`0x${toHex(keccak_256(hashToBytes(hash)))}`) >> 8n

/**
 * The nullifier an identity gets under an output, without proving anything. A claiming input
 * names it before the proof exists, since the proof covers `H(body)`.
 */
export const nullifierOf = (identity: Identity, scope: Hash): string =>
  poseidon2([fieldHash(scope), identity.secretScalar]).toString()
