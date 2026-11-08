import { alreadySpent, invalidFormat } from '../../errors.ts'
import type { Group } from '../../model/group.ts'
import type { Vote } from '../../model/transition.ts'
import { entryMessage } from '../../signing/messages.ts'
import { bodyHash, sameGroup, tokenOf } from '../../transition/ids.ts'
import { enteredGroups, validateTransition } from '../../transition/validity.ts'
import type { GuardianCore } from '../core.ts'
import { parseSubmission, requireFinal } from '../submission.ts'
import { policy } from './checks.ts'

/** `POST /transitions/enter` (section 8). Writes no line. */
export function enter(core: GuardianCore, data: unknown): Promise<{ incoming_guardian: Vote }> {
  const { transition, previous } = parseSubmission(data)
  const { body } = transition
  const hash = bodyHash(transition)
  return core.write(async (tx) => {
    const mine: Group[] = []
    for (const group of enteredGroups(body)) if (await core.belongs(tx, group)) mine.push(group)
    if (mine.length === 0) throw invalidFormat('no output enters a group of this guardian')

    requireFinal(previous)
    await validateTransition(transition, previous, 'entry', core.clock())
    policy.origin(core, transition)
    policy.validity(core, body)

    const tokens = body.outputs
      .filter((output) => mine.some((group) => sameGroup(group, output.group)))
      .map(tokenOf)
    const spent = new Set(body.inputs.map((input) => input.output))
    for (const token of tokens) {
      const entry = await tx.index(token)
      // A member of both groups holds the very output this transition spends.
      if (entry?.here && !spent.has(entry.output)) {
        throw alreadySpent('this token is already held here')
      }
    }
    await tx.saveCommitment({ transition: hash, tokens, date: core.now() })
    return { incoming_guardian: await core.sign(tx, entryMessage(hash)) }
  })
}
