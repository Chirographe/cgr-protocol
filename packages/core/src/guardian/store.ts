import type { Hash } from '../crypto/hash.ts'
import type { Head, Line, RecoveryStatus } from '../model/ledger.ts'
import type { Group } from '../model/parties.ts'
import type { Rotation, State, Token } from '../model/token.ts'

export interface IndexEntry {
  token_id: Hash
  n: number
  state_hash: Hash
  here: boolean
  moved_to: Group | null
  sequence: number
}

export interface Commitment {
  state_hash: Hash
  token_id: Hash
  previous: State
  date: string
}

export interface RecoveryRequest {
  token_id: Hash
  state_hash: Hash
  proposal: Token
  previous: State
  ends_at: string
  status: RecoveryStatus
  line: number
}

/** Reads and writes inside one serialized transaction. */
export interface LedgerTransaction {
  /** Must refuse a non-null `spent` already present, whatever the caller did. */
  appendLine(line: Line): Promise<void>
  lineCount(): Promise<number>
  lines(from: number, limit: number): Promise<Line[]>
  lineHashes(): Promise<Hash[]>
  isConsumed(hash: Hash): Promise<boolean>
  rotations(): Promise<Rotation[]>
  token(stateHash: Hash): Promise<Token | null>
  saveToken(stateHash: Hash, token: Token): Promise<void>
  index(id: Hash): Promise<IndexEntry | null>
  indexEntries(): Promise<IndexEntry[]>
  saveIndex(entry: IndexEntry): Promise<void>
  saveCommitment(commitment: Commitment): Promise<void>
  deleteCommitment(stateHash: Hash): Promise<void>
  recovery(id: Hash): Promise<RecoveryRequest | null>
  recoveries(): Promise<RecoveryRequest[]>
  saveRecovery(request: RecoveryRequest): Promise<void>
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
