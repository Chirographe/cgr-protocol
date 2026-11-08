import { hashOf, type Hash } from '../crypto/hash.ts'
import { verifySignature, type Key } from '../crypto/keys.ts'
import type { Predicate } from '../model/predicate.ts'
import type { Evidence } from '../model/transition.ts'
import { evidenceMessage } from '../signing/messages.ts'
import { schemeOf } from './schemes.ts'

/**
 * When time predicates are evaluated. `attested` is for a final transition: the votes vouch
 * for the dates of their lines.
 */
export type When = Date | 'attested'

export interface EvidenceContext {
  bodyHash: Hash
  evidence: Evidence
  /** Keys with a valid signature over `H(body)`, verified once per transition. */
  signed: Set<Key>
  /** `H(x)` of every preimage. */
  revealed: Set<Hash>
  when: When
}

/** Verifies the evidence once, for every predicate of a transition. */
export function evidenceContext(bodyHash: Hash, evidence: Evidence, when: When): EvidenceContext {
  const message = evidenceMessage(bodyHash)
  const signed = new Set(
    evidence.signatures
      .filter((s) => verifySignature(s.key, s.signature, message))
      .map((s) => s.key),
  )
  const revealed = new Set(evidence.preimages.map(hashOf))
  return { bodyHash, evidence, signed, revealed, when }
}

/** The input a predicate is evaluated for, when it is a claim. */
export interface ClaimContext {
  nullifier: string
  scope: Hash
}

const atOrAfter = (when: When, date: string) =>
  when === 'attested' || when.getTime() >= Date.parse(date)

const before = (when: When, date: string) =>
  when === 'attested' || when.getTime() < Date.parse(date)

async function membership(
  predicate: { member: string; scheme: string },
  context: EvidenceContext,
  claim: ClaimContext | null,
): Promise<boolean> {
  const scheme = schemeOf(predicate.scheme)
  if (!claim || !scheme) return false
  const proof = context.evidence.proofs.find(
    (p) => p.scheme === predicate.scheme && p.nullifier === claim.nullifier,
  )
  if (!proof) return false
  try {
    return await scheme.verify({
      root: predicate.member,
      nullifier: claim.nullifier,
      scope: claim.scope,
      message: context.bodyHash,
      proof: proof.proof,
    })
  } catch {
    return false
  }
}

/** Does a predicate hold? `claim` is set only for the `claim` predicate of a claimed output. */
export async function holds(
  predicate: Predicate,
  context: EvidenceContext,
  claim: ClaimContext | null = null,
): Promise<boolean> {
  if ('sig' in predicate) return context.signed.has(predicate.sig)
  if ('after' in predicate) return atOrAfter(context.when, predicate.after)
  if ('before' in predicate) return before(context.when, predicate.before)
  if ('hash' in predicate) return context.revealed.has(predicate.hash)
  if ('member' in predicate) return membership(predicate, context, claim)
  let count = 0
  for (const part of predicate.of) {
    if (await holds(part, context, claim)) count += 1
    if (count >= predicate.threshold) return true
  }
  return false
}
