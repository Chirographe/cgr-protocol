import type { Hash } from '../crypto/hash.ts'
import type { Group } from '../model/group.ts'
import type { Head, Line, NoticeStatus } from '../model/ledger.ts'
import type { Rotation, Transition } from '../model/transition.ts'
import type { KeyVault } from './keyring.ts'
import type { MailboxStore } from './mailbox.ts'

/** Where a token stands for this guardian (section 8). */
export interface IndexEntry {
  token: Hash
  n: number
  output: Hash
  /** `H(body)` of the transition that produced `output`, or that ended the token. */
  transition: Hash
  sequence: number
  here: boolean
  /** The group holding the token, or `null` once it ended. */
  moved_to: Group | null
}

/** A promise of `/transitions/enter`, kept until the arrival is certified. */
export interface Commitment {
  transition: Hash
  tokens: Hash[]
  date: string
}

/** An announced takeover. One per token. */
export interface NoticeRecord {
  token: Hash
  transition: Transition
  previous: Transition[]
  /** `H(output)` of the noticed output of this token. */
  output: Hash
  sequence: number
  ends_at: string
  status: NoticeStatus
  line: number
}

/** A claim recorded under an output, to list them (section 10). */
export interface ClaimRecord {
  output: Hash
  transition: Hash
}

/** Reads and writes inside one serialized transaction. */
export interface LedgerTransaction {
  /** Must refuse a value of `spent` already present, whatever the caller did. */
  appendLine(line: Line): Promise<void>
  lineCount(): Promise<number>
  lines(from: number, limit: number): Promise<Line[]>
  lineHashes(): Promise<Hash[]>
  isSpent(value: Hash): Promise<boolean>
  rotations(): Promise<Rotation[]>
  saveRotation(rotation: Rotation): Promise<void>
  transition(hash: Hash): Promise<Transition | null>
  saveTransition(hash: Hash, transition: Transition): Promise<void>
  index(token: Hash): Promise<IndexEntry | null>
  indexEntries(): Promise<IndexEntry[]>
  saveIndex(entry: IndexEntry): Promise<void>
  saveClaim(claim: ClaimRecord): Promise<void>
  claims(output: Hash): Promise<Hash[]>
  commitment(transition: Hash): Promise<Commitment | null>
  saveCommitment(commitment: Commitment): Promise<void>
  deleteCommitment(transition: Hash): Promise<void>
  notice(token: Hash): Promise<NoticeRecord | null>
  notices(): Promise<NoticeRecord[]>
  saveNotice(notice: NoticeRecord): Promise<void>
}

/**
 * Durable storage of a guardian. `transaction` must serialize, roll back on error,
 * and reach stable storage before it resolves.
 */
export interface GuardianStore {
  transaction<T>(work: (tx: LedgerTransaction) => Promise<T>): Promise<T>
  publishedHead(): Promise<Head | null>
  /** Atomic and durable. Kept apart from the lines, to detect a mismatch at startup. */
  publishHead(head: Head): Promise<void>
}

/** Everything a guardian keeps. A storage technology implements this, and nothing else. */
export interface GuardianStorage {
  guardian: GuardianStore
  mailboxes: MailboxStore
  vault: KeyVault
  close(): Promise<void>
}
