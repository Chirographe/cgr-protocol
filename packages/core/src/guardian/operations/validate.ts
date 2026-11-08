import { policyRefused } from '../../errors.ts'
import type { Transition } from '../../model/transition.ts'
import { bodyHash, tokenOf } from '../../transition/ids.ts'
import { resolveInputs, type Resolved } from '../../transition/resolve.ts'
import { isTakeoverInput, validateTransition } from '../../transition/validity.ts'
import type { GuardianCore } from '../core.ts'
import { catchUp, recordTransition } from '../record.ts'
import type { LedgerTransaction } from '../store.ts'
import { parseSubmission, requireFinal } from '../submission.ts'
import { policy, requireHead, requireNewTokens } from './checks.ts'

/** A takeover input needs a notice for this very transition, ended without opposition. */
async function requireEndedNotice(
  core: GuardianCore,
  tx: LedgerTransaction,
  transition: Transition,
  { output }: Resolved,
): Promise<void> {
  const notice = await tx.notice(tokenOf(output))
  const ended = notice && core.clock().getTime() >= Date.parse(notice.ends_at)
  if (notice?.status !== 'open' || bodyHash(notice.transition) !== bodyHash(transition) || !ended) {
    throw policyRefused('no ended notice for this takeover')
  }
}

/** `POST /transitions/validate` (section 8). */
export function validate(core: GuardianCore, data: unknown): Promise<Transition> {
  const { transition, previous } = parseSubmission(data)
  const { body } = transition
  return core.write(async (tx) => {
    await core.requireMember(tx, body.group)
    const existing = await tx.transition(bodyHash(transition))
    if (existing) return existing

    requireFinal(previous)
    await catchUp(core, tx, previous)
    const resolved = resolveInputs(transition, previous)
    const takeovers: Resolved[] = []
    for (const entry of resolved) {
      if (isTakeoverInput(entry, body)) {
        await requireEndedNotice(core, tx, transition, entry)
        takeovers.push(entry)
      } else {
        await requireHead(tx, entry)
      }
    }
    await requireNewTokens(tx, body)
    policy.issuers(core, body)
    policy.validity(core, body)
    await validateTransition(transition, previous, 'authorized', core.clock())

    const recorded = await recordTransition(core, tx, transition, { vote: true })
    for (const { output } of takeovers) {
      const notice = await tx.notice(tokenOf(output))
      if (notice) await tx.saveNotice({ ...notice, status: 'completed' })
    }
    return recorded.transition
  })
}
