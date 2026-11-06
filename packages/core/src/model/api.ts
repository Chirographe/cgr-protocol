import type { Hash } from '../crypto/hash.ts'
import type { Key } from '../crypto/keys.ts'
import type { Announcement, Head, Line, OwnerEntry, TokenHead } from './ledger.ts'
import type { EntrySignature, Rotation, Token } from './token.ts'

export interface GuardianInfo {
  key: Key
  name: string
  url: string
  version: string
  policy: { open: boolean }
  rotations: Rotation[]
}

export interface Transition {
  proposal: Token
  previous: Token
}

export interface Certificate {
  token: Token
  previous: Token | null
}

/** Section 10, as seen by a client. Implemented locally by `Guardian`, or over HTTP. */
export interface GuardianApi {
  info(): Promise<GuardianInfo>
  head(): Promise<Head>
  lines(from: number, limit: number): Promise<Line[]>
  inclusionProof(line: number, size: number): Promise<Hash[]>
  consistencyProof(from: number, to: number): Promise<Hash[]>
  tokenHead(id: Hash): Promise<TokenHead>
  create(token: Token): Promise<Token>
  validate(token: Token): Promise<Token>
  enter(transition: Transition): Promise<{ incoming_guardian: EntrySignature }>
  certify(certificate: Certificate): Promise<{ line: number | null }>
  announcements(): Promise<Announcement[]>
  requestRecovery(transition: Transition): Promise<{ ends_at: string; line: number }>
  oppose(certificate: Certificate): Promise<{ line: number }>
  finalizeRecovery(request: { state_hash: Hash }): Promise<Token>
  owners(from: number, limit: number): Promise<OwnerEntry[]>
}

/** Reaches a guardian from the URL found in a group. */
export type Directory = (url: string) => GuardianApi
