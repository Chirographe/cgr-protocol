import type { Hash } from '../crypto/hash.ts'
import { hashLine, rotationsOf } from '../ledger/line.ts'
import type { Head, Line } from '../model/ledger.ts'
import type { Token } from '../model/token.ts'
import type {
  Commitment,
  GuardianStore,
  IndexEntry,
  LedgerTransaction,
  RecoveryRequest,
} from './store.ts'

interface Data {
  lines: Line[]
  tokens: Map<Hash, Token>
  index: Map<Hash, IndexEntry>
  commitments: Map<Hash, Commitment>
  recoveries: Map<Hash, RecoveryRequest>
}

const copy = (data: Data): Data => ({
  lines: [...data.lines],
  tokens: new Map(data.tokens),
  index: new Map(data.index),
  commitments: new Map(data.commitments),
  recoveries: new Map(data.recoveries),
})

/** Volatile store for tests and tools. Not durable. */
export class MemoryGuardianStore implements GuardianStore {
  private data: Data = {
    lines: [],
    tokens: new Map(),
    index: new Map(),
    commitments: new Map(),
    recoveries: new Map(),
  }
  private head: Head | null = null
  private queue: Promise<unknown> = Promise.resolve()

  transaction<T>(work: (tx: LedgerTransaction) => Promise<T>): Promise<T> {
    const run = async () => {
      const draft = copy(this.data)
      const result = await work(transactionOn(draft))
      this.data = draft
      return result
    }
    const next = this.queue.then(run, run)
    this.queue = next.catch(() => undefined)
    return next
  }

  publishedHead(): Promise<Head | null> {
    return Promise.resolve(this.head)
  }

  publishHead(head: Head): Promise<void> {
    this.head = head
    return Promise.resolve()
  }

  /** Rewrites a line behind the guardian's back, as an attacker with disk access would. */
  tamper(n: number, change: Partial<Line>): void {
    this.data.lines = this.data.lines.map((line) => (line.n === n ? { ...line, ...change } : line))
  }
}

function transactionOn(data: Data): LedgerTransaction {
  const resolved = <T>(value: T) => Promise.resolve(value)
  return {
    appendLine(line) {
      const reused = line.spent !== null && data.lines.some((l) => l.spent === line.spent)
      if (reused) return Promise.reject(new Error('spent must be unique'))
      data.lines.push(line)
      return resolved(undefined)
    },
    lineCount: () => resolved(data.lines.length),
    lines: (from, limit) => resolved(data.lines.slice(from - 1, from - 1 + limit)),
    lineHashes: () => resolved(data.lines.map(hashLine)),
    isConsumed: (hash) => resolved(data.lines.some((line) => line.spent === hash)),
    rotations: () => resolved(rotationsOf(data.lines)),
    token: (hash) => resolved(data.tokens.get(hash) ?? null),
    saveToken(hash, token) {
      data.tokens.set(hash, token)
      return resolved(undefined)
    },
    index: (id) => resolved(data.index.get(id) ?? null),
    indexEntries: () => resolved([...data.index.values()]),
    saveIndex(entry) {
      data.index.set(entry.token_id, entry)
      return resolved(undefined)
    },
    saveCommitment(commitment) {
      data.commitments.set(commitment.state_hash, commitment)
      return resolved(undefined)
    },
    deleteCommitment(hash) {
      data.commitments.delete(hash)
      return resolved(undefined)
    },
    recovery: (id) => resolved(data.recoveries.get(id) ?? null),
    recoveries: () => resolved([...data.recoveries.values()]),
    saveRecovery(request) {
      data.recoveries.set(request.token_id, request)
      return resolved(undefined)
    },
  }
}
