import type { Hash } from '../crypto/hash.ts'
import { verifySignature, type Key } from '../crypto/keys.ts'
import { findDoubleSpend, hashLine, ledgerRoot } from '../ledger/line.ts'
import { checkLedger } from '../client/ledger-check.ts'
import type { Directory } from '../model/api.ts'
import type { Head, Line } from '../model/ledger.ts'
import { headMessage, witnessMessage } from '../signing/messages.ts'
import type { Signer } from '../signing/signer.ts'

const PAGE = 500

export interface Countersignature {
  guardian: Key
  n: number
  root: Hash
  date: string
  signature: string
}

export interface FraudProof {
  guardian: Key
  reason: string
  head_a: Head
  head_b: Head | null
  date: string
}

interface Followed {
  key: Key
  url: string
  current: Key
  lastAnswer: string | null
  lastHead: Head | null
  countersignature: Countersignature | null
  /** Head seen at each `n`. */
  heads: Map<number, Head>
  frauds: FraudProof[]
}

/** Independent observer: countersigns heads and keeps proofs of forks (section 9). */
export class Witness {
  private readonly followed = new Map<Key, Followed>()

  constructor(
    private readonly signer: Signer,
    private readonly directory: Directory,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  get key(): Key {
    return this.signer.key
  }

  async follow(url: string): Promise<Key> {
    const { key } = await this.directory(url).info()
    if (!this.followed.has(key)) {
      this.followed.set(key, {
        key,
        url,
        current: key,
        lastAnswer: null,
        lastHead: null,
        countersignature: null,
        heads: new Map(),
        frauds: [],
      })
    }
    return key
  }

  private now(): string {
    return this.clock().toISOString()
  }

  private async allLines(url: string): Promise<Line[]> {
    const lines: Line[] = []
    for (;;) {
      const page = await this.directory(url).lines(lines.length + 1, PAGE)
      lines.push(...page)
      if (page.length < PAGE) return lines
    }
  }

  private fraud(entry: Followed, reason: string, a: Head, b: Head | null): FraudProof {
    const known = entry.frauds.find((f) => f.reason === reason && f.head_a.root === a.root)
    if (known) return known
    const proof = { guardian: entry.key, reason, head_a: a, head_b: b, date: this.now() }
    entry.frauds.push(proof)
    return proof
  }

  /** One round over the guardians followed. A silent guardian keeps its last answer date. */
  async observe(): Promise<void> {
    for (const entry of this.followed.values()) {
      const guardian = this.directory(entry.url)
      let status
      try {
        status = await checkLedger(guardian, entry.current, entry.lastHead)
      } catch {
        continue
      }
      entry.lastAnswer = this.now()
      if (!status.ok) {
        const head = await guardian.head()
        this.fraud(entry, status.reason, head, entry.lastHead)
        continue
      }
      const { head, key } = status
      const lines = await this.allLines(entry.url)
      const fraud = findDoubleSpend(lines)
      if (fraud !== null) {
        this.fraud(entry, `line ${fraud} spends a state twice`, head, null)
        continue
      }
      if (ledgerRoot(lines.slice(0, head.n).map(hashLine)) !== head.root) {
        this.fraud(entry, 'lines do not match the head', head, null)
        continue
      }
      this.compare(entry, head)
      entry.heads.set(head.n, head)
      entry.lastHead = head
      entry.current = key
      entry.countersignature = {
        guardian: entry.key,
        n: head.n,
        root: head.root,
        date: this.now(),
        signature: await this.signer.sign(witnessMessage(entry.key, head.n, head.root)),
      }
    }
  }

  private compare(entry: Followed, head: Head): FraudProof | null {
    const seen = entry.heads.get(head.n)
    if (!seen || seen.root === head.root) return null
    return this.fraud(entry, `two ledgers at line ${head.n}`, head, seen)
  }

  /** Compares a head shown to a client with what this witness has seen. */
  submit(guardian: Key, head: Head): { ok: boolean; fraud: FraudProof | null } {
    const entry = this.followed.get(guardian)
    if (!entry) return { ok: true, fraud: null }
    const message = headMessage(head.n, head.root)
    if (!verifySignature(entry.current, head.signature, message)) {
      return { ok: false, fraud: null }
    }
    const fraud = this.compare(entry, head)
    if (!entry.heads.has(head.n)) entry.heads.set(head.n, head)
    return { ok: fraud === null, fraud }
  }

  state() {
    return [...this.followed.values()].map((entry) => ({
      key: entry.key,
      url: entry.url,
      last_response: entry.lastAnswer,
      head: entry.countersignature,
      frauds: entry.frauds,
    }))
  }
}
