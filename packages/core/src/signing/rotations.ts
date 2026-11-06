import { verifySignature, type Key } from '../crypto/keys.ts'
import type { Rotation } from '../model/token.ts'
import { rotationMessage } from './messages.ts'
import type { Signer } from './signer.ts'

export async function signRotation(previous: Signer, next: Signer): Promise<Rotation> {
  const message = rotationMessage(previous.key, next.key)
  return {
    previous: previous.key,
    next: next.key,
    previous_signature: await previous.sign(message),
    next_signature: await next.sign(message),
  }
}

export function isValidRotation(rotation: Rotation): boolean {
  const { previous, next, previous_signature, next_signature } = rotation
  const message = rotationMessage(previous, next)
  return (
    verifySignature(previous, previous_signature, message) &&
    verifySignature(next, next_signature, message)
  )
}

/** Every key of a guardian, oldest first, or an empty list if the chain is broken. */
export function keyHistory(key: Key, rotations: Rotation[] = []): Key[] {
  const keys: Key[] = []
  for (const [i, rotation] of rotations.entries()) {
    const next = rotations[i + 1]?.previous ?? key
    if (rotation.next !== next || !isValidRotation(rotation)) return []
    keys.push(rotation.previous)
  }
  return [...keys, key]
}

/** Follows published rotations from a known key. Returns `null` if one is invalid. */
export function followRotations(key: Key, rotations: Rotation[]): Key | null {
  let current = key
  for (const rotation of rotations) {
    if (!isValidRotation(rotation)) return null
    if (rotation.previous === current) current = rotation.next
  }
  return current
}
