import type { Submission } from '../../model/api.ts'
import { toleratedFaults } from '../../model/group.ts'
import { producerOf, resolveInputs } from '../../transition/resolve.ts'
import { hasQuorum } from '../../transition/validity.ts'
import type { Check, CheckName, PartyContext } from './context.ts'
import { isHead } from './heads.ts'
import { ledgersHold } from './ledgers.ts'
import { hasNotice } from './notices.ts'

const check = (name: CheckName, ok: boolean, blocking = true): Check => ({ name, ok, blocking })

const all = async (items: Promise<boolean>[]) => (await Promise.all(items)).every(Boolean)

/** Section 9: what a party checks before adding its evidence. */
export async function inspect(submission: Submission, context: PartyContext): Promise<Check[]> {
  const { transition, previous } = submission
  const { body } = transition
  const now = context.now ?? new Date()
  let resolved
  try {
    resolved = resolveInputs(transition, previous)
  } catch {
    return [check('previous-final', false)]
  }
  const producers = resolved.map(({ input }) => producerOf(previous, input.output))
  const final = producers.every((p) => p !== null && hasQuorum(p))
  const groups = [body.group, ...body.outputs.map((o) => o.group)]
  const members = groups.flatMap((g) => g.members.map((m) => context.trustOf(m.key)))
  const blockedOk = groups.every((g) => {
    const blocked = g.members.filter((m) => context.trustOf(m.key) === 'blocked').length
    return blocked <= toleratedFaults(g.members.length)
  })

  const [profile, unspent, noticed, ledgers] = await Promise.all([
    Promise.resolve(context.expects(submission)),
    all(resolved.map(({ output }) => isHead(context.directory, output))),
    all(resolved.map(async ({ output }) => !(await hasNotice(context.directory, output)))),
    all(producers.flatMap((p) => (p ? [ledgersHold(p, context)] : []))),
  ])
  return [
    check('previous-final', final),
    check('profile', profile),
    check('not-expired', !body.valid_until || now.getTime() < Date.parse(body.valid_until)),
    check('guardians-not-blocked', blockedOk),
    check('unspent', unspent),
    check('no-notice', noticed),
    check('ledger', ledgers, false),
    check(
      'guardians-trusted',
      members.every((t) => t === 'trusted'),
      false,
    ),
  ]
}

export const canSign = (checks: Check[]): boolean => checks.every((c) => c.ok || !c.blocking)
