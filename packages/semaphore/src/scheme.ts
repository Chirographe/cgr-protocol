import type { MembershipClaim, MembershipScheme } from '@chirographe/core'
import { verifyProof, type SemaphoreProof } from '@semaphore-protocol/proof'
import { z } from 'zod'
import { MAX_DEPTH, MIN_DEPTH, POINT_COUNT, SEMAPHORE_SCHEME } from './constants.ts'
import { hashAsInteger } from './fields.ts'

const FieldElement = z.string().regex(/^(0|[1-9][0-9]*)$/)

/** The `proof` value of a `semaphore/4` evidence entry. */
export const SemaphoreProofSchema = z.strictObject({
  depth: z.number().int().min(MIN_DEPTH).max(MAX_DEPTH),
  points: z.array(FieldElement).length(POINT_COUNT),
})

export type PackedProof = z.infer<typeof SemaphoreProofSchema>

/** Rebuilds the Semaphore proof that a claim stands for. */
export function semaphoreProof(claim: MembershipClaim): SemaphoreProof | null {
  const parsed = SemaphoreProofSchema.safeParse(claim.proof)
  if (!parsed.success) return null
  return {
    merkleTreeDepth: parsed.data.depth,
    merkleTreeRoot: claim.root,
    nullifier: claim.nullifier,
    scope: hashAsInteger(claim.scope),
    message: hashAsInteger(claim.message),
    points: parsed.data.points as SemaphoreProof['points'],
  }
}

/** Verifies offline: the verification keys ship with the library. */
export const semaphoreScheme: MembershipScheme = {
  id: SEMAPHORE_SCHEME,
  async verify(claim) {
    const proof = semaphoreProof(claim)
    if (!proof) return false
    try {
      return await verifyProof(proof)
    } catch {
      return false
    }
  },
}
