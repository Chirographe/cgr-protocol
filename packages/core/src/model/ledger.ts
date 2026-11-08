import type { Hash } from '../crypto/hash.ts'
import type { Key } from '../crypto/keys.ts'
import type { Group } from './group.ts'

export const LINE_TYPES = ['transition', 'notice', 'opposition', 'rotation'] as const
export type LineType = (typeof LINE_TYPES)[number]

export interface Line {
  n: number
  type: LineType
  hash: Hash
  spent: Hash[]
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
  | { here: true; output: Hash; n: number; sequence: number }
  | { here: false; moved_to: Group | null; sequence: number }

export const NOTICE_STATUSES = ['open', 'opposed', 'completed'] as const
export type NoticeStatus = (typeof NOTICE_STATUSES)[number]

export interface Notice {
  token: Hash
  transition: Hash
  sequence: number
  ends_at: string
  status: NoticeStatus
}

export interface OwnerEntry {
  n: number
  ephemeral?: Key
  keys: Key[]
}
