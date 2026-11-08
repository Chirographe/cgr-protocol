import { hashOf, type Hash } from '../crypto/hash.ts'
import { ProtocolError, notAuthorized } from '../errors.ts'
import type { Group } from '../model/group.ts'
import type { Body, Transition, Vote } from '../model/transition.ts'
import { evidenceContext, holds, type EvidenceContext, type When } from '../predicate/evaluate.ts'
import { entryMessage, guardianMessage } from '../signing/messages.ts'
import { groupQuorum } from '../signing/quorum.ts'
import { covenantHolds } from './covenant.ts'
import { bodyHash, isClaim, outputId, sameGroup } from './ids.ts'
import { lineage } from './lineage.ts'
import { resolveInputs, type Resolved } from './resolve.ts'

/**
 * How far a transition has come. `entry` is authorized but for entries and votes,
 * `authorized` but for votes.
 */
export type Stage = 'entry' | 'authorized' | 'final'

const STAGES: Stage[] = ['entry', 'authorized', 'final']
const reached = (stage: Stage, step: Stage) => STAGES.indexOf(stage) >= STAGES.indexOf(step)

/** A spend of an output held elsewhere, by the recovery group of its token (section 6). */
export function isTakeoverInput({ input, output }: Resolved, body: Body): boolean {
  const recovery = output.rules.recovery
  return (
    !isClaim(input) &&
    !sameGroup(output.group, body.group) &&
    recovery !== null &&
    sameGroup(recovery.group, body.group)
  )
}

export const isTakeover = (resolved: Resolved[], body: Body): boolean =>
  resolved.some((r) => isTakeoverInput(r, body))

async function inputsHold(resolved: Resolved[], body: Body, context: EvidenceContext) {
  for (const entry of resolved) {
    const { input, output } = entry
    if (!sameGroup(output.group, body.group) && !isTakeoverInput(entry, body)) {
      throw notAuthorized('an input is held by another group')
    }
    const ok =
      input.nullifier === undefined
        ? await holds(output.lock, context)
        : output.claim !== undefined &&
          (await holds(output.claim, context, {
            nullifier: input.nullifier,
            scope: outputId(output),
          }))
    if (!ok) throw notAuthorized('an input predicate does not hold')
  }
}

async function outputsHold(resolved: Resolved[], body: Body, context: EvidenceContext) {
  for (const { output, spent } of lineage(body.outputs, resolved)) {
    if (spent) {
      if (!(await covenantHolds(output, spent, context))) {
        throw notAuthorized('the covenant does not hold')
      }
    } else if (!sameGroup(output.rules.group, body.group)) {
      throw notAuthorized('a token starts outside the group that records it')
    } else if (!(await holds(output.rules.issuer, context))) {
      throw notAuthorized('the issuer predicate does not hold')
    }
  }
}

/** Each output group other than `body.group`, once. */
export function enteredGroups(body: Body): Group[] {
  const groups = new Map<Hash, Group>()
  for (const { group } of body.outputs) {
    if (!sameGroup(group, body.group)) groups.set(hashOf(group), group)
  }
  return [...groups.values()]
}

function entriesHold(transition: Transition, hash: Hash) {
  const entries = transition.incoming ?? []
  for (const group of enteredGroups(transition.body)) {
    if (!groupQuorum(group, entries, () => entryMessage(hash))) {
      throw notAuthorized('an entering group has no quorum')
    }
  }
}

const voteMessage = (hash: Hash) => (vote: Vote) =>
  vote.line !== undefined && vote.line_hash !== undefined
    ? guardianMessage(hash, vote.line, vote.line_hash)
    : new Uint8Array()

/** Throws the error of the first rule of section 6 that fails. */
export async function validateTransition(
  transition: Transition,
  previous: Transition[],
  stage: Stage,
  when: When,
): Promise<void> {
  const { body } = transition
  const hash = bodyHash(transition)
  const resolved = resolveInputs(transition, previous)
  const context = evidenceContext(hash, transition.evidence, stage === 'final' ? 'attested' : when)

  await inputsHold(resolved, body, context)
  await outputsHold(resolved, body, context)
  if (reached(stage, 'authorized')) entriesHold(transition, hash)
  if (when !== 'attested' && stage !== 'final' && body.valid_until) {
    if (when.getTime() >= Date.parse(body.valid_until)) {
      throw new ProtocolError('EXPIRED', 'valid_until has passed')
    }
  }
  if (
    stage === 'final' &&
    !groupQuorum(body.group, transition.guardians ?? [], voteMessage(hash))
  ) {
    throw notAuthorized('the group has no quorum')
  }
}

/**
 * A quorum of `body.group` voted for it. For a transition whose own inputs are not at hand,
 * this is all that can be checked: the votes vouch for the rest.
 */
export const hasQuorum = (transition: Transition): boolean =>
  groupQuorum(transition.body.group, transition.guardians ?? [], voteMessage(bodyHash(transition)))

/** True when the transition is final against these previous transitions. */
export async function isFinal(transition: Transition, previous: Transition[]): Promise<boolean> {
  try {
    await validateTransition(transition, previous, 'final', 'attested')
    return true
  } catch (error) {
    if (error instanceof ProtocolError) return false
    throw error
  }
}
