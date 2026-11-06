import type { Key } from '../crypto/keys.ts'

export interface Policy {
  /** Keys allowed to create tokens here. `null` means anyone. */
  creators: Key[] | null
  /** Guardians tokens may arrive from. `null` means any. */
  origins: Key[] | null
  maxProposalSeconds: number
}

export const OPEN_POLICY: Policy = {
  creators: null,
  origins: null,
  maxProposalSeconds: 7 * 24 * 3600,
}
