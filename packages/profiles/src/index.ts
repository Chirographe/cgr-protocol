import type { Output } from '@chirographe/core'
import { contractData, CONTRACT } from './contract.ts'
import { titleData, TITLE } from './title.ts'
import { VOTE } from './vote/data.ts'
import { electionData } from './vote/election.ts'

export * from './common.ts'
export * from './contract.ts'
export * from './title.ts'
export * from './vote/ballot.ts'
export * from './vote/data.ts'
export * from './vote/election.ts'
export * from './vote/tally.ts'

export type ProfileId = typeof TITLE | typeof CONTRACT | typeof VOTE

export const PROFILES: readonly ProfileId[] = [TITLE, CONTRACT, VOTE]

/** How a client shows an output it holds or watches, or `null` for an unknown profile. */
export function describe(output: Output): { profile: ProfileId; label: string } | null {
  const title = titleData(output)
  if (title) return { profile: TITLE, label: title.label }
  const contract = contractData(output)
  if (contract) return { profile: CONTRACT, label: contract.label }
  const election = electionData(output)
  if (election) return { profile: VOTE, label: election.question }
  return null
}
