import { alreadySpent, invalidFormat } from '../../errors.ts'
import { bodyHash, outputId, tokenOf } from '../../transition/ids.ts'
import { resolveInputs } from '../../transition/resolve.ts'
import { isTakeoverInput, validateTransition } from '../../transition/validity.ts'
import type { GuardianCore } from '../core.ts'
import { parseSubmission, requireFinal } from '../submission.ts'

/** `POST /recovery/notice` (section 8): announces a takeover, which may be opposed. */
export function notice(
  core: GuardianCore,
  data: unknown,
): Promise<{ ends_at: string; line: number }> {
  const { transition, previous } = parseSubmission(data)
  const { body } = transition
  const hash = bodyHash(transition)
  return core.write(async (tx) => {
    await core.requireMember(tx, body.group)
    requireFinal(previous)
    const takeovers = resolveInputs(transition, previous).filter((r) => isTakeoverInput(r, body))
    if (takeovers.length === 0) throw invalidFormat('this transition is not a takeover')
    await validateTransition(transition, previous, 'entry', core.clock())

    for (const { output } of takeovers) {
      const open = await tx.notice(tokenOf(output))
      if (open?.status !== 'open') continue
      if (bodyHash(open.transition) === hash) return { ends_at: open.ends_at, line: open.line }
      throw alreadySpent('a notice is already open on this token')
    }

    const delay = Math.max(
      ...takeovers.map(({ output }) => output.rules.recovery?.delay_seconds ?? 0),
    )
    const ends_at = new Date(core.clock().getTime() + delay * 1000).toISOString()
    const line = await core.addLine(tx, { type: 'notice', hash, spent: [] })
    for (const { output } of takeovers) {
      await tx.saveNotice({
        token: tokenOf(output),
        transition,
        previous,
        output: outputId(output),
        sequence: output.sequence,
        ends_at,
        status: 'open',
        line: line.n,
      })
    }
    return { ends_at, line: line.n }
  })
}
