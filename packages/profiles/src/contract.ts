import {
  composeRules,
  producedOutputs,
  composeTransition,
  continueOutput,
  isOwnLock,
  payTo,
  predicates,
  spendOf,
  startOutput,
  type Address,
  type Group,
  type Hash,
  type Output,
  type Predicate,
  type Recovery,
  type Submission,
  type Transition,
  type Wallet,
} from '@chirographe/core'
import { DocumentDataSchema, dataOf, soleOutput, type DocumentData } from './common.ts'

/**
 * A contract between parties. All of them sign its creation and each amendment; the parties
 * never change. Its date is that of the guardians' lines.
 */
export const CONTRACT = 'contract/1'

export interface NewContract {
  parties: Address[]
  group: Group
  data: DocumentData
  recovery?: Recovery | null
  validUntil?: Date
}

/** Unsigned: every party signs it. */
export function proposeContract(contract: NewContract): Transition {
  const { locks, ephemeral } = payTo(contract.parties)
  const everyone = predicates.threshold(locks.length, locks)
  const rules = composeRules({
    profile: CONTRACT,
    issuer: everyone,
    covenant: [{ keep: ['lock'] }],
    recovery: contract.recovery ?? null,
    group: contract.group,
  })
  const output = startOutput(rules, {
    lock: everyone,
    data: DocumentDataSchema.parse(contract.data),
    ...(ephemeral ? { ephemeral } : {}),
  })
  return composeTransition({
    group: contract.group,
    outputs: [output],
    ...(contract.validUntil ? { validUntil: contract.validUntil } : {}),
  })
}

/** A new version of the document, signed by every party. */
export const amendContract = (
  contract: Output,
  data: DocumentData,
  validUntil?: Date,
): Transition =>
  composeTransition({
    group: contract.group,
    inputs: [spendOf(contract)],
    outputs: [continueOutput(contract, { data: DocumentDataSchema.parse(data) })],
    ...(validUntil ? { validUntil } : {}),
  })

/** Ends the contract, signed by every party. */
export const terminateContract = (contract: Output, validUntil?: Date): Transition =>
  composeTransition({
    group: contract.group,
    inputs: [spendOf(contract)],
    ...(validUntil ? { validUntil } : {}),
  })

export const contractData = (output: Output): DocumentData | null =>
  output.rules.profile === CONTRACT ? dataOf(output, DocumentDataSchema) : null

/** The lock of each party. */
export const partiesOf = (output: Output): Predicate[] =>
  'of' in output.lock ? output.lock.of : [output.lock]

/** Is this wallet one of the parties? */
export const isParty = (output: Output, wallet: Wallet): boolean =>
  partiesOf(output).some((part) => isOwnLock(wallet, part, output.ephemeral))

/**
 * Check 2 for a party: a contract this wallet is party to, about the document it was shown.
 * A termination has no output: the party checks the contract it ends instead.
 */
export function expectsContract(
  { transition, previous }: Submission,
  wallet: Wallet,
  digest: Hash | null,
): boolean {
  const next = soleOutput(transition)
  const [input] = transition.body.inputs
  const spent = producedOutputs(previous).get(input?.output ?? '') ?? null
  const subject = next ?? spent
  if (!subject || !contractData(subject) || !isParty(subject, wallet)) return false
  return digest === null || contractData(subject)?.digest === digest
}
