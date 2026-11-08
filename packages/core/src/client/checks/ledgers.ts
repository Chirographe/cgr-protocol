import type { Transition } from '../../model/transition.ts'
import { memberOf } from '../../signing/quorum.ts'
import { bodyHash } from '../../transition/ids.ts'
import { checkLedger, checkVoteLine } from '../ledger-check.ts'
import type { PartyContext } from './context.ts'

/** Check 7: every vote of a transition passes the ledger check. */
export async function ledgersHold(
  transition: Transition,
  { directory, lastSeen }: PartyContext,
): Promise<boolean> {
  const hash = bodyHash(transition)
  const { group } = transition.body
  const results = await Promise.all(
    (transition.guardians ?? []).map(async (vote) => {
      const key = memberOf(group, vote)
      const member = group.members.find((m) => m.key === key)
      if (!member) return true
      try {
        const guardian = directory(member.url)
        const status = await checkLedger(guardian, member.key, lastSeen.get(member.url) ?? null)
        if (!status.ok) return false
        lastSeen.set(member.url, status.head)
        return await checkVoteLine(guardian, hash, vote, status.head)
      } catch {
        return false
      }
    }),
  )
  return results.every(Boolean)
}
