import { Group } from '@semaphore-protocol/group'
import { Identity } from '@semaphore-protocol/identity'

/**
 * A voter's secret identity. Its private key never leaves the voter. Pass the same bytes
 * everywhere: a string and its bytes give different identities.
 */
export const createIdentity = (privateKey?: Uint8Array): Identity => new Identity(privateKey)

/** What a voter registers: the commitment of its identity, in decimal. */
export const commitmentOf = (identity: Identity): string => identity.commitment.toString()

/** The root of a list of commitments, as written in a `member` predicate. */
export const rootOf = (commitments: string[]): string =>
  new Group(commitments.map(BigInt)).root.toString()

export { Identity }
