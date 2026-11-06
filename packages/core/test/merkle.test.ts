import { describe, expect, it } from 'vitest'
import { fromHex, toHex, utf8 } from '../src/encoding/bytes.ts'
import {
  checkConsistency,
  checkInclusion,
  consistencyPath,
  consistencyProof,
  findDoubleSpend,
  hashFromBytes,
  hashOf,
  inclusionPath,
  inclusionProof,
  ledgerRoot,
  merkleRoot,
  verifyConsistency,
  verifyInclusion,
  type Line,
} from '../src/index.ts'

// Test data of the Certificate Transparency reference implementation.
const LEAVES = [
  '',
  '00',
  '10',
  '2021',
  '3031',
  '40414243',
  '5051525354555657',
  '606162636465666768696a6b6c6d6e6f',
].map(fromHex)
const ROOTS = [
  '6e340b9cffb37a989ca544e6bb780a2c78901d3fb33738768511a30617afa01d',
  'fac54203e7cc696cf0dfcb42c92a1d9dbaf70ad9e621f4bd8d98662f00e3c125',
  'aeb6bcfe274b70a14fb067a5e5578264db0fa9b51af5e0ba159158f329e06e77',
  'd37ee418976dd95753c1c73862b9398fa2a2cf9b4ff0fdfe8b30cd95209614b7',
  '4e3bbb1f7b478dcfe71fb631631519a3bca12c9aefca1612bfce4c13a86264d4',
  '76e67dadbcdf1e10e1b74ddc608abd2f98dfb16fbce75277b5232a127f2087ef',
  'ddb89be403809e325750d3d263cd78929c2942b7942a34b77e122c9594a74c8c',
  '5dc9da79a70659a9ad559cb701ded9a2ab9d823aad2f4960cfe370eff4604328',
]

const leaves = (n: number) => Array.from({ length: n }, (_, i) => utf8(`leaf ${i}`))

describe('Merkle tree (RFC 9162)', () => {
  it('matches the reference roots', () => {
    ROOTS.forEach((root, i) => {
      expect(toHex(merkleRoot(LEAVES.slice(0, i + 1)))).toBe(root)
    })
  })

  it('has the hash of nothing as empty root', () => {
    expect(toHex(merkleRoot([]))).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    )
  })

  it('proves the inclusion of every leaf, for every size', () => {
    for (let size = 1; size <= 33; size++) {
      const tree = leaves(size)
      const root = merkleRoot(tree)
      for (let i = 0; i < size; i++) {
        const path = inclusionProof(tree, i)
        expect(verifyInclusion(tree[i] as Uint8Array, i, size, path, root)).toBe(true)
      }
    }
  })

  it('proves consistency between every pair of sizes', () => {
    for (let second = 1; second <= 33; second++) {
      const tree = leaves(second)
      const root = merkleRoot(tree)
      for (let first = 0; first <= second; first++) {
        const old = merkleRoot(tree.slice(0, first))
        expect(verifyConsistency(first, second, old, root, consistencyProof(tree, first))).toBe(
          true,
        )
      }
    }
  })

  it('rejects a forged inclusion', () => {
    const tree = leaves(9)
    const root = merkleRoot(tree)
    const path = inclusionProof(tree, 3)
    expect(verifyInclusion(utf8('forged'), 3, 9, path, root)).toBe(false)
    expect(verifyInclusion(tree[3] as Uint8Array, 4, 9, path, root)).toBe(false)
    expect(verifyInclusion(tree[3] as Uint8Array, 9, 9, path, root)).toBe(false)
    expect(verifyInclusion(tree[3] as Uint8Array, 3, 9, [...path, root], root)).toBe(false)
  })

  it('rejects a rewritten history', () => {
    const tree = leaves(12)
    const rewritten = [...tree.slice(0, 6), utf8('rewritten'), ...tree.slice(7)]
    const old = merkleRoot(tree.slice(0, 7))
    const path = consistencyProof(rewritten, 7)
    expect(verifyConsistency(7, 12, old, merkleRoot(rewritten), path)).toBe(false)
    expect(verifyConsistency(12, 7, old, old, [])).toBe(false)
    expect(verifyConsistency(5, 5, old, merkleRoot(tree), [])).toBe(false)
    expect(verifyConsistency(0, 5, old, old, [old])).toBe(false)
    expect(verifyConsistency(3, 5, old, old, [])).toBe(false)
    expect(verifyConsistency(7, 12, old, merkleRoot(tree), [old, old, old, old, old, old])).toBe(
      false,
    )
  })
})

describe('ledger helpers', () => {
  const hashes = Array.from({ length: 5 }, (_, i) => hashOf({ i }))

  it('works on hashes', () => {
    const root = ledgerRoot(hashes)
    const path = inclusionPath(hashes, 2)
    expect(checkInclusion(hashes[1] as string, 2, 5, path, root)).toBe(true)
    const from = { n: 3, root: ledgerRoot(hashes.slice(0, 3)) }
    expect(checkConsistency(from, { n: 5, root: root }, consistencyPath(hashes, 3))).toBe(true)
    expect(root).toBe(hashFromBytes(merkleRoot(hashes.map((h) => fromHex(h.slice(7))))))
  })

  it('finds a state spent twice', () => {
    const line = (n: number, spent: string | null): Line => ({
      n,
      type: 'transfer',
      token_id: 'x',
      state_hash: 'y',
      spent,
      origin: null,
      date: 'd',
    })
    expect(findDoubleSpend([line(1, null), line(2, 'a'), line(3, null)])).toBeNull()
    expect(findDoubleSpend([line(1, 'a'), line(2, 'b'), line(3, 'a')])).toBe(3)
  })
})
