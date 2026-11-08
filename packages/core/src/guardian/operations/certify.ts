import { invalidFormat } from '../../errors.ts'
import { withVotes } from '../../transition/evidence.ts'
import { bodyHash } from '../../transition/ids.ts'
import { enteredGroups, validateTransition } from '../../transition/validity.ts'
import type { GuardianCore } from '../core.ts'
import { catchUp, recordTransition } from '../record.ts'
import { parseSubmission, requireFinal } from '../submission.ts'
import { policy } from './checks.ts'

/** `POST /transitions/certify` (section 8): records a final transition once, and
 * keeps its votes. */
export function certify(core: GuardianCore, data: unknown): Promise<{ line: number | null }> {
  const { transition, previous } = parseSubmission(data)
  const { body } = transition
  return core.write(async (tx) => {
    const source = await core.belongs(tx, body.group)
    let arriving = false
    for (const group of enteredGroups(body)) arriving ||= await core.belongs(tx, group)
    if (!source && !arriving) throw invalidFormat('this transition does not concern this guardian')

    requireFinal(previous)
    await validateTransition(transition, previous, 'final', 'attested')
    const recorded = await tx.transition(bodyHash(transition))
    if (recorded) {
      // A member that voted kept only its own vote: it now keeps the final transition.
      await tx.saveTransition(bodyHash(transition), withVotes(recorded, transition.guardians ?? []))
      return { line: null }
    }
    if (arriving && !source) policy.origin(core, transition)

    await catchUp(core, tx, previous)
    const { line } = await recordTransition(core, tx, transition, { vote: false })
    await tx.deleteCommitment(bodyHash(transition))
    return { line: line.n }
  })
}
