import { hashFromBytes, hashOf, hashToBytes, type Hash } from '../crypto/hash.ts'
import type { Line } from '../model/ledger.ts'
import {
  consistencyProof,
  inclusionProof,
  merkleRoot,
  verifyConsistency,
  verifyInclusion,
} from './merkle.ts'

export const hashLine = (line: Line): Hash => hashOf(line)

export const ledgerRoot = (lineHashes: Hash[]): Hash =>
  hashFromBytes(merkleRoot(lineHashes.map(hashToBytes)))

export const inclusionPath = (lineHashes: Hash[], line: number): Hash[] =>
  inclusionProof(lineHashes.map(hashToBytes), line - 1).map(hashFromBytes)

export const consistencyPath = (lineHashes: Hash[], size: number): Hash[] =>
  consistencyProof(lineHashes.map(hashToBytes), size).map(hashFromBytes)

export const checkInclusion = (
  lineHash: Hash,
  line: number,
  size: number,
  path: Hash[],
  root: Hash,
): boolean =>
  verifyInclusion(hashToBytes(lineHash), line - 1, size, path.map(hashToBytes), hashToBytes(root))

export const checkConsistency = (
  from: { n: number; root: Hash },
  to: { n: number; root: Hash },
  path: Hash[],
): boolean =>
  verifyConsistency(
    from.n,
    to.n,
    hashToBytes(from.root),
    hashToBytes(to.root),
    path.map(hashToBytes),
  )

/** The line number of a value spent twice, which proves guardian fraud. */
export function findDoubleSpend(lines: Line[]): number | null {
  const consumed = new Set<Hash>()
  for (const line of lines) {
    for (const value of line.spent) {
      if (consumed.has(value)) return line.n
      consumed.add(value)
    }
  }
  return null
}
