import type { Hash } from '../crypto/hash.ts'
import type { Key } from '../crypto/keys.ts'
import type { Group, Owner } from './parties.ts'
import type { Rotation } from './token.ts'

export type LineType =
  | 'creation'
  | 'transfer'
  | 'departure'
  | 'arrival'
  | 'catch_up'
  | 'announcement'
  | 'opposition'
  | 'takeover'
  | 'rotation'

export interface Line {
  n: number
  type: LineType
  token_id: Hash
  state_hash: Hash
  spent: Hash | null
  origin: { guardian: Key; line: number } | Rotation | null
  date: string
}

export interface Head {
  n: number
  root: Hash
  date: string
  signature: string
  locked?: boolean
}

export type TokenHead =
  | { here: true; state_hash: Hash; n: number; sequence: number }
  | { here: false; moved_to: Group; sequence: number }

export type RecoveryStatus = 'announced' | 'opposed' | 'taken_over'

export interface Announcement {
  token_id: Hash
  state_hash: Hash
  claimed_sequence: number
  ends_at: string
  status: RecoveryStatus
}

export interface OwnerEntry {
  n: number
  ephemeral?: Key
  owner: Owner
}
