import type { Directory } from '../model/api.ts'
import type { Transition } from '../model/transition.ts'
import { withEntries, withVotes } from '../transition/evidence.ts'
import { enteredGroups } from '../transition/validity.ts'
import { broadcast, quorumCall } from './quorum.ts'

/**
 * Section 7. Records an authorized transition. Every step is idempotent: run it again to
 * resume. `previous` holds the final transitions that produced its inputs.
 */
export async function commit(
  directory: Directory,
  transition: Transition,
  previous: Transition[],
): Promise<Transition> {
  const { group } = transition.body
  const entering = enteredGroups(transition.body)

  let entered = transition
  for (const target of entering) {
    const answers = await quorumCall(directory, target, (g) => g.enter({ transition, previous }))
    entered = withEntries(
      entered,
      answers.map((a) => a.incoming_guardian),
    )
  }

  const votes = await quorumCall(directory, group, (g) =>
    g.validate({ transition: entered, previous }),
  )
  const final = withVotes(
    entered,
    votes.flatMap((v) => v.guardians ?? []),
  )

  for (const target of entering) {
    await quorumCall(directory, target, (g) => g.certify({ transition: final, previous }))
  }
  await broadcast(directory, [group, ...entering], { transition: final, previous })
  return final
}
