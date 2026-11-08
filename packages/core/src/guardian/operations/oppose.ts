import { notAuthorized, unknown } from '../../errors.ts'
import type { Transition } from '../../model/transition.ts'
import { bodyHash, isClaim, tokenOf } from '../../transition/ids.ts'
import type { GuardianCore } from '../core.ts'
import type { NoticeRecord } from '../store.ts'
import { parseSubmission, requireFinal } from '../submission.ts'

/** Does a final transition prove a state later than the noticed one? */
function opposes(notice: NoticeRecord, transition: Transition): boolean {
  if (bodyHash(transition) === bodyHash(notice.transition)) return false
  const { inputs, outputs } = transition.body
  return (
    inputs.some((input) => !isClaim(input) && input.output === notice.output) ||
    outputs.some((output) => tokenOf(output) === notice.token && output.sequence > notice.sequence)
  )
}

/** `POST /recovery/oppose` (section 8). */
export function oppose(core: GuardianCore, data: unknown): Promise<{ line: number }> {
  const { transition, previous } = parseSubmission(data)
  return core.write(async (tx) => {
    const open = (await tx.notices()).filter((n) => n.status === 'open')
    const opposed = open.filter((notice) => opposes(notice, transition))
    if (open.length === 0) throw unknown('no open notice')
    if (opposed.length === 0) throw notAuthorized('this transition proves no later state')

    // The later state is final by its votes: its own inputs need not be at hand.
    requireFinal([transition, ...previous])
    const line = await core.addLine(tx, {
      type: 'opposition',
      hash: bodyHash(opposed[0]!.transition),
      spent: [],
    })
    for (const notice of opposed) await tx.saveNotice({ ...notice, status: 'opposed' })
    return { line: line.n }
  })
}
