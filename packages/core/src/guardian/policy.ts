import type { Key } from '../crypto/keys.ts'

/** What a guardian accepts beyond the protocol (section 8). */
export interface Policy {
  /** Keys allowed in the issuer of a new token here. `null` means anyone. */
  issuers: Key[] | null
  /** Guardians tokens may arrive from. `null` means any. */
  origins: Key[] | null
  /** Longest `valid_until` accepted, from now. */
  maxValiditySeconds: number
}

export const OPEN_POLICY: Policy = {
  issuers: null,
  origins: null,
  maxValiditySeconds: 7 * 24 * 3600,
}
