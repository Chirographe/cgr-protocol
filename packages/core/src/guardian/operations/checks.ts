import { ProtocolError, alreadySpent, policyRefused, unknown } from '../../errors.ts'
import type { Body, Transition } from '../../model/transition.ts'
import { predicateKeys } from '../../predicate/shape.ts'
import { spentValue, tokenOf } from '../../transition/ids.ts'
import type { Resolved } from '../../transition/resolve.ts'
import type { GuardianCore } from '../core.ts'
import type { LedgerTransaction } from '../store.ts'

/** The output of a non-takeover input is the head of its token, held here. */
export async function requireHead(
  tx: LedgerTransaction,
  { input, output }: Resolved,
): Promise<void> {
  if (await tx.isSpent(spentValue(input))) throw alreadySpent('this input is spent')
  const entry = await tx.index(tokenOf(output))
  if (!entry) throw unknown('unknown token')
  if (!entry.here) {
    throw new ProtocolError('TOKEN_MOVED', 'token left this guardian', { moved_to: entry.moved_to })
  }
  if (entry.output !== input.output) throw alreadySpent('this output is no longer the head')
}

/** No token the transition starts exists here. */
export async function requireNewTokens(tx: LedgerTransaction, body: Body): Promise<void> {
  for (const output of body.outputs) {
    if (output.sequence === 0 && (await tx.index(tokenOf(output)))) {
      throw alreadySpent('this token already exists')
    }
  }
}

/** Section 8: a guardian may refuse a new token, an arrival or a validity period. */
export const policy = {
  issuers(core: GuardianCore, body: Body): void {
    const { issuers } = core.policy
    if (!issuers) return
    for (const output of body.outputs) {
      if (output.sequence > 0) continue
      if (!predicateKeys(output.rules.issuer).some((key) => issuers.includes(key))) {
        throw policyRefused('issuer refused by this guardian')
      }
    }
  },

  origin(core: GuardianCore, transition: Transition): void {
    const { origins } = core.policy
    if (origins && !transition.body.group.members.some((m) => origins.includes(m.key))) {
      throw policyRefused('arrivals from this group are refused')
    }
  },

  validity(core: GuardianCore, body: Body): void {
    if (!body.valid_until) return
    const seconds = (Date.parse(body.valid_until) - core.clock().getTime()) / 1000
    if (seconds > core.policy.maxValiditySeconds) throw policyRefused('valid_until is too far')
  },
}
