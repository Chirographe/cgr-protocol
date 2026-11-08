import { verifySignature, type Key } from '../crypto/keys.ts'
import type { Group } from '../model/group.ts'
import type { Vote } from '../model/transition.ts'
import { keyHistory } from './rotations.ts'

/** The member a vote counts for: the one whose key is in the vote's key history. */
export function memberOf(group: Group, vote: Vote): Key | null {
  const members = new Set(group.members.map((m) => m.key))
  return keyHistory(vote.key, vote.rotations).find((key) => members.has(key)) ?? null
}

/** `quorum(G, votes, msg)` of section 4. */
export function groupQuorum(
  group: Group,
  votes: Vote[],
  message: (vote: Vote) => Uint8Array,
): boolean {
  const signers = new Set<Key>()
  for (const vote of votes) {
    const member = memberOf(group, vote)
    if (member && verifySignature(vote.key, vote.signature, message(vote))) signers.add(member)
  }
  return signers.size >= group.threshold
}
