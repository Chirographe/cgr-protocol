import {
  commit,
  composeRules,
  composeTransition,
  continueOutput,
  generateSigner,
  outputId,
  predicates,
  signTransition,
  spendOf,
  startOutput,
  type Constraint,
  type Group,
  type Output,
  type OutputFields,
  type Predicate,
  type Recovery,
  type Signer,
  type Transition,
} from '../../src/index.ts'
import type { Network } from './network.ts'

const { sig } = predicates

/** An output and the final transition that produced it. */
export interface Held {
  output: Output
  transition: Transition
}

export const heldAt = (transition: Transition, index = 0): Held => ({
  output: transition.body.outputs[index]!,
  transition,
})

export interface Mint {
  group: Group
  owner: Signer
  issuer?: Signer
  issuerPredicate?: Predicate
  lock?: Predicate
  claim?: Predicate
  covenant?: Constraint[]
  recovery?: Recovery | null
  data?: OutputFields['data']
  profile?: string
}

/** Composes and signs a transition that starts one token. */
export async function newToken(spec: Mint): Promise<Transition> {
  const issuer = spec.issuer ?? spec.owner
  const rules = composeRules({
    profile: spec.profile ?? 'test/1',
    issuer: spec.issuerPredicate ?? sig(issuer.key),
    covenant: spec.covenant ?? [],
    recovery: spec.recovery ?? null,
    group: spec.group,
  })
  const output = startOutput(rules, {
    lock: spec.lock ?? sig(spec.owner.key),
    ...(spec.claim ? { claim: spec.claim } : {}),
    ...(spec.data !== undefined ? { data: spec.data } : {}),
  })
  return signTransition(composeTransition({ group: spec.group, outputs: [output] }), [issuer])
}

export async function mint(net: Network, spec: Mint): Promise<Held> {
  return heldAt(await commit(net.directory, await newToken(spec), []))
}

/** Composes and signs the spend of a held output into its continuation. */
export async function move(
  held: Held,
  signers: Signer[],
  changes: Partial<OutputFields> = {},
  group: Group = held.output.group,
): Promise<Transition> {
  const next = continueOutput(held.output, changes)
  const transition = composeTransition({ group, inputs: [spendOf(held.output)], outputs: [next] })
  return signTransition(transition, signers)
}

export async function transfer(
  net: Network,
  held: Held,
  signers: Signer[],
  changes: Partial<OutputFields> = {},
): Promise<Held> {
  return heldAt(await commit(net.directory, await move(held, signers, changes), [held.transition]))
}

export const people = (...names: string[]) =>
  Object.fromEntries(names.map((name) => [name, generateSigner()])) as Record<string, Signer>

export { outputId }
