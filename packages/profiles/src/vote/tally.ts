import { hasQuorum, outputId, type Output, type Transition } from '@chirographe/core'
import { BallotDataSchema } from './data.ts'
import { electionData } from './election.ts'

export interface Tally {
  counts: number[]
  ballots: number
}

/** Counts final ballots under an election, once per nullifier, from any guardians' answers. */
export function tally(election: Output, claims: Transition[]): Tally {
  const options = electionData(election)?.options ?? []
  const scope = outputId(election)
  const counts = options.map(() => 0)
  const seen = new Set<string>()
  for (const ballot of claims) {
    const [input] = ballot.body.inputs
    const data = BallotDataSchema.safeParse(ballot.body.data)
    if (ballot.body.inputs.length !== 1 || input?.output !== scope || !input.nullifier) continue
    if (!data.success || data.data.choice >= counts.length || seen.has(input.nullifier)) continue
    if (!hasQuorum(ballot)) continue
    seen.add(input.nullifier)
    counts[data.data.choice] = (counts[data.data.choice] ?? 0) + 1
  }
  return { counts, ballots: seen.size }
}
