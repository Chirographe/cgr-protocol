import {
  composeRules,
  composeTransition,
  predicates,
  startOutput,
  type Group,
  type Key,
  type Output,
  type Predicate,
  type Transition,
} from '@chirographe/core'
import { SEMAPHORE_SCHEME, rootOf } from '@chirographe/semaphore'
import { dataOf } from '../common.ts'
import { ElectionDataSchema, VOTE, type ElectionData, type Roll } from './data.ts'

const { all, sig, after, before, member } = predicates

export interface NewElection {
  organizer: Key
  group: Group
  data: ElectionData
  roll: Roll
  closesAt: Date
}

/**
 * Unsigned: the organizer signs it. Registered voters claim under it until it closes, once
 * each. The organizer cannot touch it before then, so the roll cannot change during the vote.
 */
export function createElection(election: NewElection): Transition {
  const rules = composeRules({
    profile: VOTE,
    issuer: sig(election.organizer),
    group: election.group,
  })
  const output = startOutput(rules, {
    lock: all(sig(election.organizer), after(election.closesAt)),
    claim: all(
      member(rootOf(election.roll.commitments), SEMAPHORE_SCHEME),
      before(election.closesAt),
    ),
    data: ElectionDataSchema.parse(election.data),
  })
  return composeTransition({ group: election.group, outputs: [output] })
}

export const electionData = (output: Output): ElectionData | null =>
  output.rules.profile === VOTE ? dataOf(output, ElectionDataSchema) : null

const parts = (predicate: Predicate | undefined): Predicate[] =>
  !predicate ? [] : 'of' in predicate ? predicate.of : [predicate]

/** The root of the roll, from the claim predicate. */
export function rollRoot(output: Output): string | null {
  const found = parts(output.claim).find((p) => 'member' in p)
  return found && 'member' in found ? found.member : null
}

/** When voting closes, from the claim predicate. */
export function closesAt(output: Output): Date | null {
  const found = parts(output.claim).find((p) => 'before' in p)
  return found && 'before' in found ? new Date(found.before) : null
}

/** Does a published roll match the election? A voter checks it before proving. */
export const matchesRoll = (output: Output, roll: Roll): boolean =>
  rollRoot(output) === rootOf(roll.commitments)
