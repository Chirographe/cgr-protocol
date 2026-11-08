import type { Hash } from '../crypto/hash.ts'
import { verifySignature, type Key } from '../crypto/keys.ts'
import { checkConsistency, checkInclusion, hashLine } from '../ledger/line.ts'
import type { GuardianApi } from '../model/api.ts'
import type { Head } from '../model/ledger.ts'
import type { Vote } from '../model/transition.ts'
import { headMessage } from '../signing/messages.ts'
import { followRotations } from '../signing/rotations.ts'

export type LedgerStatus = { ok: true; head: Head; key: Key } | { ok: false; reason: string }

/** Section 9: does the new head extend the last one seen? */
export async function checkLedger(
  guardian: GuardianApi,
  key: Key,
  lastSeen: Head | null,
): Promise<LedgerStatus> {
  const head = await guardian.head()
  if (head.locked !== undefined) return { ok: false, reason: 'guardian is locked' }

  const { rotations } = await guardian.info()
  const current = followRotations(key, rotations)
  if (!current) return { ok: false, reason: 'invalid key rotation' }
  if (!verifySignature(current, head.signature, headMessage(head.n, head.root))) {
    return { ok: false, reason: 'invalid head signature' }
  }
  if (lastSeen) {
    const path = await guardian.consistencyProof(lastSeen.n, head.n)
    if (!checkConsistency(lastSeen, head, path)) {
      return { ok: false, reason: 'head does not extend the last one seen' }
    }
  }
  return { ok: true, head, key: current }
}

/** Is the line named by a vote really in the ledger, for this transition? */
export async function checkVoteLine(
  guardian: GuardianApi,
  bodyHash: Hash,
  vote: Vote,
  head: Head,
): Promise<boolean> {
  if (vote.line === undefined || vote.line_hash === undefined || vote.line > head.n) return false
  const [line] = await guardian.lines(vote.line, 1)
  if (!line || hashLine(line) !== vote.line_hash) return false
  // Only a `transition` line records a spend: a `notice` carries the same hash.
  if (line.type !== 'transition' || line.hash !== bodyHash) return false
  const path = await guardian.inclusionProof(vote.line, head.n)
  return checkInclusion(vote.line_hash, vote.line, head.n, path, head.root)
}
