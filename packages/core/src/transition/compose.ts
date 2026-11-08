import { FORMAT, LIMITS } from '../constants.ts'
import type { Key } from '../crypto/keys.ts'
import { randomBytes, toHex } from '../encoding/bytes.ts'
import type { Group, Recovery } from '../model/group.ts'
import type { Constraint, Predicate } from '../model/predicate.ts'
import type { Value } from '../model/primitives.ts'
import type { Input, Output, Rules, Transition } from '../model/transition.ts'
import { defined, outputId } from './ids.ts'

export interface NewToken {
  profile: string
  issuer: Predicate
  covenant?: Constraint[]
  recovery?: Recovery | null
  group: Group
}

export const composeRules = (token: NewToken): Rules => ({
  profile: token.profile,
  issuer: token.issuer,
  covenant: token.covenant ?? [],
  recovery: token.recovery ?? null,
  group: token.group,
  nonce: toHex(randomBytes(LIMITS.nonceBytes)),
})

export interface OutputFields {
  lock: Predicate
  claim?: Predicate
  data?: Value
  ephemeral?: Key
  group?: Group
}

/** The first output of a token, held by the group that records it unless told otherwise. */
export const startOutput = (rules: Rules, fields: OutputFields): Output =>
  defined({
    rules,
    sequence: 0,
    lock: fields.lock,
    claim: fields.claim,
    data: fields.data,
    ephemeral: fields.ephemeral,
    group: fields.group ?? rules.group,
  })

/**
 * The next output of a token. Unchanged fields are kept, except `ephemeral`, which belongs to
 * the lock it was derived for.
 */
export function continueOutput(spent: Output, changes: Partial<OutputFields> = {}): Output {
  const lockChanges = changes.lock !== undefined
  return defined({
    rules: spent.rules,
    sequence: spent.sequence + 1,
    lock: changes.lock ?? spent.lock,
    claim: 'claim' in changes ? changes.claim : spent.claim,
    data: 'data' in changes ? changes.data : spent.data,
    ephemeral: lockChanges ? changes.ephemeral : spent.ephemeral,
    group: changes.group ?? spent.group,
  })
}

export const spendOf = (output: Output): Input => ({ output: outputId(output) })

export const claimOf = (output: Output, nullifier: string): Input => ({
  output: outputId(output),
  nullifier,
})

export interface NewTransition {
  group: Group
  inputs?: Input[]
  outputs?: Output[]
  data?: Value
  validUntil?: Date
}

/** A transition with no evidence yet. */
export const composeTransition = (input: NewTransition): Transition => ({
  format: FORMAT,
  body: defined({
    group: input.group,
    inputs: input.inputs ?? [],
    outputs: input.outputs ?? [],
    data: input.data,
    valid_until: input.validUntil?.toISOString(),
  }),
  evidence: { signatures: [], preimages: [], proofs: [] },
})

/** Moves a token to another group, otherwise unchanged. Unsigned. */
export const regroup = (output: Output, group: Group, validUntil?: Date): Transition =>
  composeTransition({
    group: output.group,
    inputs: [spendOf(output)],
    outputs: [continueOutput(output, { group })],
    ...(validUntil ? { validUntil } : {}),
  })
