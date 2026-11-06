import { hashOf } from '../crypto/hash.ts'
import { verifySignature, type Key } from '../crypto/keys.ts'
import { checkConsistency, checkInclusion, hashLine } from '../ledger/line.ts'
import type { GuardianApi } from '../model/api.ts'
import type { Head } from '../model/ledger.ts'
import type { GuardianSignature, State } from '../model/token.ts'
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
  if (head.locked) return { ok: false, reason: 'guardian is locked' }

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

/** Is the line named by a guardian signature really in the ledger, for this state? */
export async function checkTokenLine(
  guardian: GuardianApi,
  state: State,
  signature: GuardianSignature,
  head: Head,
): Promise<boolean> {
  const [line] = await guardian.lines(signature.line, 1)
  if (!line || hashLine(line) !== signature.line_hash || line.state_hash !== hashOf(state)) {
    return false
  }
  const path = await guardian.inclusionProof(signature.line, head.n)
  return checkInclusion(signature.line_hash, signature.line, head.n, path, head.root)
}
