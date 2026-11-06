import { sha256 } from '../crypto/hash.ts'
import { concat, equalBytes } from '../encoding/bytes.ts'

/** Merkle tree of RFC 9162, section 2.1. */

const LEAF = Uint8Array.of(0)
const NODE = Uint8Array.of(1)

const leafHash = (data: Uint8Array) => sha256(concat(LEAF, data))
const nodeHash = (left: Uint8Array, right: Uint8Array) => sha256(concat(NODE, left, right))

/** Largest power of two strictly below n. */
const split = (n: number) => 2 ** Math.floor(Math.log2(n - 1))

export function merkleRoot(leaves: Uint8Array[]): Uint8Array {
  if (leaves.length === 0) return sha256(new Uint8Array())
  const [first] = leaves
  if (leaves.length === 1 && first) return leafHash(first)
  const k = split(leaves.length)
  return nodeHash(merkleRoot(leaves.slice(0, k)), merkleRoot(leaves.slice(k)))
}

/** Audit path of a leaf, from the bottom of the tree. */
export function inclusionProof(leaves: Uint8Array[], index: number): Uint8Array[] {
  if (leaves.length <= 1) return []
  const k = split(leaves.length)
  return index < k
    ? [...inclusionProof(leaves.slice(0, k), index), merkleRoot(leaves.slice(k))]
    : [...inclusionProof(leaves.slice(k), index - k), merkleRoot(leaves.slice(0, k))]
}

function subproof(m: number, leaves: Uint8Array[], complete: boolean): Uint8Array[] {
  if (m === leaves.length) return complete ? [] : [merkleRoot(leaves)]
  const k = split(leaves.length)
  return m <= k
    ? [...subproof(m, leaves.slice(0, k), complete), merkleRoot(leaves.slice(k))]
    : [...subproof(m - k, leaves.slice(k), false), merkleRoot(leaves.slice(0, k))]
}

/** Proves that the first `size` leaves are a prefix of `leaves`. */
export function consistencyProof(leaves: Uint8Array[], size: number): Uint8Array[] {
  return size === 0 || size === leaves.length ? [] : subproof(size, leaves, true)
}

export function verifyInclusion(
  leaf: Uint8Array,
  index: number,
  size: number,
  path: Uint8Array[],
  root: Uint8Array,
): boolean {
  if (index >= size) return false
  let fn = index
  let sn = size - 1
  let hash = leafHash(leaf)
  for (const sibling of path) {
    if (sn === 0) return false
    if (fn % 2 === 1 || fn === sn) {
      hash = nodeHash(sibling, hash)
      while (fn % 2 === 0 && fn !== 0) {
        fn = Math.floor(fn / 2)
        sn = Math.floor(sn / 2)
      }
    } else {
      hash = nodeHash(hash, sibling)
    }
    fn = Math.floor(fn / 2)
    sn = Math.floor(sn / 2)
  }
  return sn === 0 && equalBytes(hash, root)
}

export function verifyConsistency(
  firstSize: number,
  secondSize: number,
  firstRoot: Uint8Array,
  secondRoot: Uint8Array,
  path: Uint8Array[],
): boolean {
  if (firstSize > secondSize) return false
  if (firstSize === 0) return path.length === 0
  if (firstSize === secondSize) return path.length === 0 && equalBytes(firstRoot, secondRoot)

  const nodes = Number.isInteger(Math.log2(firstSize)) ? [firstRoot, ...path] : path
  let fn = firstSize - 1
  let sn = secondSize - 1
  while (fn % 2 === 1) {
    fn = Math.floor(fn / 2)
    sn = Math.floor(sn / 2)
  }
  const [start, ...rest] = nodes
  if (!start) return false
  let first = start
  let second = start
  for (const node of rest) {
    if (sn === 0) return false
    if (fn % 2 === 1 || fn === sn) {
      first = nodeHash(node, first)
      second = nodeHash(node, second)
      while (fn % 2 === 0 && fn !== 0) {
        fn = Math.floor(fn / 2)
        sn = Math.floor(sn / 2)
      }
    } else {
      second = nodeHash(second, node)
    }
    fn = Math.floor(fn / 2)
    sn = Math.floor(sn / 2)
  }
  return sn === 0 && equalBytes(first, firstRoot) && equalBytes(second, secondRoot)
}
