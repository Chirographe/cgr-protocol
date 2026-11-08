import {
  composeRules,
  composeTransition,
  continueOutput,
  isOwnLock,
  outputId,
  payTo,
  sameField,
  spendOf,
  startOutput,
  tokenOf,
  type Address,
  type Group,
  type Output,
  type Predicate,
  type Recovery,
  type Submission,
  type Transition,
  type Wallet,
} from '@chirographe/core'
import { DocumentDataSchema, dataOf, soleOutput, type DocumentData } from './common.ts'

/**
 * A property title: issued by a registry, held by one owner, changing hands with the consent
 * of the recipient. Its document never changes.
 */
export const TITLE = 'title/1'

export interface NewTitle {
  /** Who may issue: usually the registry's keys. */
  issuer: Predicate
  group: Group
  holder: Address
  data: DocumentData
  recovery?: Recovery | null
  validUntil?: Date
}

/** Unsigned: the issuer signs it. */
export function issueTitle(title: NewTitle): Transition {
  const rules = composeRules({
    profile: TITLE,
    issuer: title.issuer,
    covenant: [{ keep: ['data'] }, { accept: true }],
    recovery: title.recovery ?? null,
    group: title.group,
  })
  const { locks, ephemeral } = payTo([title.holder])
  const output = startOutput(rules, {
    lock: locks[0]!,
    data: DocumentDataSchema.parse(title.data),
    ...(ephemeral ? { ephemeral } : {}),
  })
  return composeTransition({
    group: title.group,
    outputs: [output],
    ...(title.validUntil ? { validUntil: title.validUntil } : {}),
  })
}

/** Unsigned: the holder signs it, then the recipient. */
export function transferTitle(title: Output, to: Address, validUntil?: Date): Transition {
  const { locks, ephemeral } = payTo([to])
  const next = continueOutput(title, { lock: locks[0]!, ...(ephemeral ? { ephemeral } : {}) })
  return composeTransition({
    group: title.group,
    inputs: [spendOf(title)],
    outputs: [next],
    ...(validUntil ? { validUntil } : {}),
  })
}

export const titleData = (output: Output): DocumentData | null =>
  output.rules.profile === TITLE ? dataOf(output, DocumentDataSchema) : null

/** Check 2 for a recipient: one title, unchanged, now locked to this wallet alone. */
export function expectsTitle({ transition, previous }: Submission, wallet: Wallet): boolean {
  const next = soleOutput(transition)
  const spent = previous
    .flatMap((p) => p.body.outputs)
    .find((o) => transition.body.inputs.some((i) => i.output === outputId(o)))
  return (
    next !== null &&
    spent !== undefined &&
    transition.body.inputs.length === 1 &&
    titleData(next) !== null &&
    tokenOf(next) === tokenOf(spent) &&
    sameField(next.data, spent.data) &&
    isOwnLock(wallet, next.lock, next.ephemeral)
  )
}
