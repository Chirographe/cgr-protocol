import { hashOf, type Hash } from '../crypto/hash.ts'
import type { Group } from '../model/group.ts'
import type { Input, Output, Rules, Transition } from '../model/transition.ts'

export const outputId = (output: Output): Hash => hashOf(output)

export const tokenOf = (output: Output): Hash => hashOf(output.rules)

export const tokenId = (rules: Rules): Hash => hashOf(rules)

export const bodyHash = (transition: Transition): Hash => hashOf(transition.body)

/** What an input consumes in a ledger. */
export const spentValue = (input: Input): Hash => hashOf(input)

export const isClaim = (input: Input): boolean => input.nullifier !== undefined

/** Groups compare by hash: order matters. */
export const sameGroup = (a: Group, b: Group): boolean => hashOf(a) === hashOf(b)

/** Two optional fields are the same when both are absent, or both present and equal. */
export const sameField = (a: unknown, b: unknown): boolean =>
  a === undefined || b === undefined ? a === b : hashOf(a) === hashOf(b)

/** Copies an object without its `undefined` fields, which have no canonical form. */
export const defined = <T extends object>(value: T): T =>
  Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as T
