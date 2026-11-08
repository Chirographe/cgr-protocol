import type { Hash } from '../crypto/hash.ts'
import type { Key } from '../crypto/keys.ts'
import type { Head, Line, Notice, OwnerEntry, TokenHead } from './ledger.ts'
import type { Rotation, Transition, Vote } from './transition.ts'

export interface GuardianInfo {
  key: Key
  name: string
  url: string
  version: string
  policy: { open: boolean }
  rotations: Rotation[]
}

/** The body of every `POST` of `/transitions` and `/recovery`. */
export interface Submission {
  transition: Transition
  /** The final transitions that produced the inputs. */
  previous: Transition[]
}

/** Section 10, as seen by a client. Implemented locally by `Guardian`, or over HTTP. */
export interface GuardianApi {
  info(): Promise<GuardianInfo>
  head(): Promise<Head>
  lines(from: number, limit: number): Promise<Line[]>
  inclusionProof(line: number, size: number): Promise<Hash[]>
  consistencyProof(from: number, to: number): Promise<Hash[]>
  tokenHead(token: Hash): Promise<TokenHead>
  transition(hash: Hash): Promise<Transition>
  claims(output: Hash): Promise<Transition[]>
  validate(submission: Submission): Promise<Transition>
  enter(submission: Submission): Promise<{ incoming_guardian: Vote }>
  certify(submission: Submission): Promise<{ line: number | null }>
  notices(): Promise<Notice[]>
  notice(submission: Submission): Promise<{ ends_at: string; line: number }>
  oppose(submission: Submission): Promise<{ line: number }>
  owners(from: number, limit: number): Promise<OwnerEntry[]>
}

/** Reaches a guardian from the URL found in a group. */
export type Directory = (url: string) => GuardianApi
