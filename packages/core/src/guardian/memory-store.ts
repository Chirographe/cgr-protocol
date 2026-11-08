import type { Hash } from '../crypto/hash.ts'
import { hashLine } from '../ledger/line.ts'
import type { Head, Line } from '../model/ledger.ts'
import type { Rotation, Transition } from '../model/transition.ts'
import type {
  ClaimRecord,
  Commitment,
  GuardianStore,
  IndexEntry,
  LedgerTransaction,
  NoticeRecord,
} from './store.ts'

interface Data {
  lines: Line[]
  rotations: Rotation[]
  transitions: Map<Hash, Transition>
  index: Map<Hash, IndexEntry>
  claims: ClaimRecord[]
  commitments: Map<Hash, Commitment>
  notices: Map<Hash, NoticeRecord>
}

const copy = (data: Data): Data => ({
  lines: [...data.lines],
  rotations: [...data.rotations],
  transitions: new Map(data.transitions),
  index: new Map(data.index),
  claims: [...data.claims],
  commitments: new Map(data.commitments),
  notices: new Map(data.notices),
})

const empty = (): Data => ({
  lines: [],
  rotations: [],
  transitions: new Map(),
  index: new Map(),
  claims: [],
  commitments: new Map(),
  notices: new Map(),
})

/** Volatile store for tests and tools. Not durable. */
export class MemoryGuardianStore implements GuardianStore {
  private data = empty()
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
  const done = <T>(value: T) => Promise.resolve(value)
  const spent = () => new Set(data.lines.flatMap((line) => line.spent))
  return {
    appendLine(line) {
      const consumed = spent()
      if (line.spent.some((value) => consumed.has(value))) {
        return Promise.reject(new Error('spent must be unique'))
      }
      data.lines.push(line)
      return done(undefined)
    },
    lineCount: () => done(data.lines.length),
    lines: (from, limit) => done(data.lines.slice(from - 1, from - 1 + limit)),
    lineHashes: () => done(data.lines.map(hashLine)),
    isSpent: (value) => done(spent().has(value)),
    rotations: () => done([...data.rotations]),
    saveRotation: (rotation) => done(void data.rotations.push(rotation)),
    transition: (hash) => done(data.transitions.get(hash) ?? null),
    saveTransition: (hash, transition) => done(void data.transitions.set(hash, transition)),
    index: (token) => done(data.index.get(token) ?? null),
    indexEntries: () => done([...data.index.values()]),
    saveIndex: (entry) => done(void data.index.set(entry.token, entry)),
    saveClaim: (claim) => done(void data.claims.push(claim)),
    claims: (output) =>
      done(data.claims.filter((c) => c.output === output).map((c) => c.transition)),
    commitment: (hash) => done(data.commitments.get(hash) ?? null),
    saveCommitment: (c) => done(void data.commitments.set(c.transition, c)),
    deleteCommitment: (hash) => done(void data.commitments.delete(hash)),
    notice: (token) => done(data.notices.get(token) ?? null),
    notices: () => done([...data.notices.values()]),
    saveNotice: (notice) => done(void data.notices.set(notice.token, notice)),
  }
}
