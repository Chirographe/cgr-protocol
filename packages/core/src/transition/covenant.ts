import type { Constraint } from '../model/predicate.ts'
import type { Output } from '../model/transition.ts'
import { holds, type EvidenceContext } from '../predicate/evaluate.ts'
import { sameField } from './ids.ts'

async function constraintHolds(
  constraint: Constraint,
  output: Output,
  spent: Output,
  context: EvidenceContext,
): Promise<boolean> {
  if ('keep' in constraint) {
    return constraint.keep.every((field) => sameField(output[field], spent[field]))
  }
  if ('groups' in constraint) {
    return output.group.members.every((m) => constraint.groups.includes(m.key))
  }
  return holds(output.lock, context)
}

/** Does every constraint of the token hold on this continuation? */
export async function covenantHolds(
  output: Output,
  spent: Output,
  context: EvidenceContext,
): Promise<boolean> {
  for (const constraint of output.rules.covenant) {
    if (!(await constraintHolds(constraint, output, spent, context))) return false
  }
  return true
}
