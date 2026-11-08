import type { Hash } from '../crypto/hash.ts'
import type { Value } from '../model/primitives.ts'

/** What `member` needs to verify a proof. */
export interface MembershipClaim {
  root: string
  nullifier: string
  /** `H(output)` of the output claimed under. */
  scope: Hash
  /** `H(body)` of the claiming transition. */
  message: Hash
  proof: Value
}

/** A proof system behind `member`. A new one is a new implementation and a registration. */
export interface MembershipScheme {
  readonly id: string
  verify(claim: MembershipClaim): Promise<boolean>
}

const schemes = new Map<string, MembershipScheme>()

export function registerScheme(scheme: MembershipScheme): void {
  schemes.set(scheme.id, scheme)
}

export const schemeOf = (id: string): MembershipScheme | null => schemes.get(id) ?? null
