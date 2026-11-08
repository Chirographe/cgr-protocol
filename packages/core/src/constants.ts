/** Wire format identifier, also the prefix of every signed message. */
export const FORMAT = 'chirographe/1'

/** Limits of section 3. */
export const LIMITS = {
  inputs: 32,
  outputs: 32,
  valueBytes: 1024,
  profileLength: 100,
  groupMembers: 31,
  predicateDepth: 4,
  predicateLeaves: 32,
  nonceBytes: 16,
} as const
