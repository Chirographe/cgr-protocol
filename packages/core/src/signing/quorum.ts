import { hashToBytes, type Hash } from '../crypto/hash.ts'
import { verifySignature, type Key } from '../crypto/keys.ts'
import type { Group, Owner } from '../model/parties.ts'
import type { OwnerSignature, Rotation } from '../model/token.ts'
import { keyHistory } from './rotations.ts'

/** Distinct keys of the owner with a valid signature over the state hash. */
export function ownerQuorum(owner: Owner, signatures: OwnerSignature[], stateHash: Hash): boolean {
  const message = hashToBytes(stateHash)
  const signers = new Set(
    signatures
      .filter((s) => owner.keys.includes(s.key) && verifySignature(s.key, s.signature, message))
      .map((s) => s.key),
  )
  return signers.size >= owner.threshold
}

interface MemberSignature {
  key: Key
  signature: string
  rotations?: Rotation[] | undefined
}

/** A member signature counts for the member whose key is in its key history. */
export function groupQuorum<T extends MemberSignature>(
  group: Group,
  signatures: T[],
  message: (signature: T) => Uint8Array,
): boolean {
  const members = new Set(group.members.map((m) => m.key))
  const signers = new Set<Key>()
  for (const signature of signatures) {
    const member = keyHistory(signature.key, signature.rotations).find((k) => members.has(k))
    if (member && verifySignature(signature.key, signature.signature, message(signature))) {
      signers.add(member)
    }
  }
  return signers.size >= group.threshold
}
