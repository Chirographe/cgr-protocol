import {
  addProofs,
  bodyHash,
  claimOf,
  composeTransition,
  outputId,
  type Output,
  type Transition,
} from '@chirographe/core'
import { nullifierOf, proveMembership, type Identity } from '@chirographe/semaphore'
import { BallotDataSchema, type Roll } from './data.ts'
import { matchesRoll } from './election.ts'

export interface NewBallot {
  election: Output
  identity: Identity
  roll: Roll
  choice: number
}

/**
 * A ballot: one claim under the election, carrying the choice. The proof shows the voter is
 * on the roll without saying who; the nullifier stops a second ballot.
 */
export async function castBallot(ballot: NewBallot): Promise<Transition> {
  const { election, identity, roll } = ballot
  if (!matchesRoll(election, roll)) throw new Error('this roll is not the roll of the election')
  const scope = outputId(election)
  const transition = composeTransition({
    group: election.group,
    inputs: [claimOf(election, nullifierOf(identity, scope))],
    data: BallotDataSchema.parse({ choice: ballot.choice }),
  })
  const proof = await proveMembership({
    identity,
    commitments: roll.commitments,
    scope,
    message: bodyHash(transition),
  })
  return addProofs(transition, [proof])
}
