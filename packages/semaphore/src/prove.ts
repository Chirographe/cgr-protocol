import type { Hash, ZkProof } from '@chirographe/core'
import { Group } from '@semaphore-protocol/group'
import type { Identity } from '@semaphore-protocol/identity'
import { generateProof } from '@semaphore-protocol/proof'
import { SEMAPHORE_SCHEME } from './constants.ts'
import { hashAsInteger } from './fields.ts'

export interface MembershipRequest {
  identity: Identity
  /** Every commitment of the roll, in its published order. */
  commitments: string[]
  /** `H(output)` of the output claimed under. */
  scope: Hash
  /** `H(body)` of the claiming transition. */
  message: Hash
}

/**
 * Proves membership for one claim. The circuit artifacts are fetched on first use.
 * Returns the evidence entry; its nullifier goes in the claiming input.
 */
export async function proveMembership(request: MembershipRequest): Promise<ZkProof> {
  const group = new Group(request.commitments.map(BigInt))
  const proof = await generateProof(
    request.identity,
    group,
    hashAsInteger(request.message),
    hashAsInteger(request.scope),
  )
  return {
    scheme: SEMAPHORE_SCHEME,
    nullifier: proof.nullifier,
    proof: { depth: proof.merkleTreeDepth, points: [...proof.points] },
  }
}
