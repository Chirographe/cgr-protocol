import { hashOf } from '../crypto/hash.ts'
import { verifySignature } from '../crypto/keys.ts'
import { invalidFormat } from '../errors.ts'
import type { Value } from '../model/primitives.ts'
import type { Evidence, Signature, Transition, Vote, ZkProof } from '../model/transition.ts'
import { evidenceMessage } from '../signing/messages.ts'
import type { Signer } from '../signing/signer.ts'
import { bodyHash } from './ids.ts'

const byKey = <T extends { key: string }>(items: T[]): T[] => [
  ...new Map(items.map((item) => [item.key, item])).values(),
]

const unique = <T>(items: T[], id: (item: T) => string): T[] => [
  ...new Map(items.map((item) => [id(item), item])).values(),
]

/** One signature per key, a valid one when there is: nobody can overwrite another's. */
function signaturesOf(transition: Transition, signatures: Signature[]): Signature[] {
  const message = evidenceMessage(bodyHash(transition))
  const valid = signatures.filter((s) => verifySignature(s.key, s.signature, message))
  return byKey([...signatures.filter((s) => !valid.includes(s)), ...valid])
}

function withEvidence(transition: Transition, extra: Partial<Evidence>): Transition {
  const { evidence } = transition
  return {
    ...transition,
    evidence: {
      signatures: signaturesOf(transition, [...evidence.signatures, ...(extra.signatures ?? [])]),
      preimages: unique([...evidence.preimages, ...(extra.preimages ?? [])], hashOf),
      proofs: unique(
        [...evidence.proofs, ...(extra.proofs ?? [])],
        (p) => `${p.scheme}|${p.nullifier}`,
      ),
    },
  }
}

/** Adds a signature over `H(body)` by each signer. */
export async function signTransition(
  transition: Transition,
  signers: Signer[],
): Promise<Transition> {
  const message = evidenceMessage(bodyHash(transition))
  const signatures: Signature[] = await Promise.all(
    signers.map(async (signer) => ({
      type: 'raw' as const,
      key: signer.key,
      signature: await signer.sign(message),
    })),
  )
  return withEvidence(transition, { signatures })
}

export const revealPreimages = (transition: Transition, preimages: Value[]): Transition =>
  withEvidence(transition, { preimages })

export const addProofs = (transition: Transition, proofs: ZkProof[]): Transition =>
  withEvidence(transition, { proofs })

/** Joins the evidence two parties added to the same transition. */
export function mergeEvidence(transition: Transition, other: Transition): Transition {
  if (bodyHash(transition) !== bodyHash(other)) throw invalidFormat('not the same transition')
  return withEvidence(transition, other.evidence)
}

/** Merges guardian votes, one per key. */
export const withVotes = (transition: Transition, votes: Vote[]): Transition => ({
  ...transition,
  guardians: byKey([...(transition.guardians ?? []), ...votes]),
})

/** Merges entries of incoming groups, one per key. */
export const withEntries = (transition: Transition, entries: Vote[]): Transition => ({
  ...transition,
  incoming: byKey([...(transition.incoming ?? []), ...entries]),
})
