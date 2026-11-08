import type { Hash } from '../crypto/hash.ts'
import { unknown } from '../errors.ts'
import type { Input, Output, Transition } from '../model/transition.ts'
import { outputId } from './ids.ts'

/** An input with the output it names. */
export interface Resolved {
  input: Input
  output: Output
}

/** Every output of these transitions, by `H(output)`. */
export function producedOutputs(transitions: Transition[]): Map<Hash, Output> {
  const outputs = new Map<Hash, Output>()
  for (const transition of transitions) {
    for (const output of transition.body.outputs) outputs.set(outputId(output), output)
  }
  return outputs
}

/** Finds each input's output among the transitions that produced them (section 6). */
export function resolveInputs(transition: Transition, previous: Transition[]): Resolved[] {
  const outputs = producedOutputs(previous)
  return transition.body.inputs.map((input) => {
    const output = outputs.get(input.output)
    if (!output) throw unknown('an input names an output absent from the previous transitions')
    return { input, output }
  })
}

/** The transition among `previous` that produced this output. */
export const producerOf = (previous: Transition[], output: Hash): Transition | null =>
  previous.find((t) => t.body.outputs.some((o) => outputId(o) === output)) ?? null
