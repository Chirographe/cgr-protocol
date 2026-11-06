import type { Hash } from '../crypto/hash.ts'
import { verifySignature, type Key } from '../crypto/keys.ts'
import { findDoubleSpend, hashLine, ledgerRoot } from '../ledger/line.ts'
import { checkLedger } from '../client/ledger-check.ts'
import type { Directory } from '../model/api.ts'
import type { Head, Line } from '../model/ledger.ts'
import type { FraudProof, WitnessGuardian } from '../model/responses.ts'
import { headMessage, witnessMessage } from '../signing/messages.ts'
import type { Signer } from '../signing/signer.ts'
import type { Followed, WitnessStore } from './store.ts'

const PAGE = 500

/** Independent observer: countersigns heads and keeps proofs of forks (section 9). */
export class Witness {
  constructor(
    private readonly signer: Signer,
    private readonly directory: Directory,
    private readonly store: WitnessStore,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  get key(): Key {
    return this.signer.key
  }

  async follow(url: string): Promise<Key> {
    const known = (await this.store.followed()).find((entry) => entry.url === url)
    if (known) return known.key
    const { key } = await this.directory(url).info()
    await this.store.saveFollowed({
      key,
      url,
      current: key,
      lastAnswer: null,
      lastHead: null,
      countersignature: null,
    })
    return key
  }

  private now(): string {
    return this.clock().toISOString()
  }

  /** Reads past the head, by one page at most: a guardian must not decide how much is read. */
  private async allLines(url: string, headSize: number): Promise<Line[]> {
    const lines: Line[] = []
    for (;;) {
      const page = await this.directory(url).lines(lines.length + 1, PAGE)
      lines.push(...page.slice(0, PAGE))
      if (page.length < PAGE || lines.length >= headSize + PAGE) return lines
    }
  }

  private fraud(entry: Followed, reason: string, a: Head, b: Head | null): Promise<FraudProof> {
    const proof = { guardian: entry.key, reason, head_a: a, head_b: b, date: this.now() }
    return this.store.recordFraud(proof)
  }

  /** One round over the guardians followed. A silent guardian keeps its last answer date. */
  async observe(): Promise<void> {
    for (const entry of await this.store.followed()) {
      // One guardian failing halfway must not stop the round for the others.
      await this.observeOne(entry).catch(() => undefined)
    }
  }

  private async observeOne(followed: Followed): Promise<void> {
    const guardian = this.directory(followed.url)
    const status = await checkLedger(guardian, followed.current, followed.lastHead)
    const entry = { ...followed, lastAnswer: this.now() }
    await this.store.saveFollowed(entry)
    if (!status.ok) {
      await this.fraud(entry, status.reason, await guardian.head(), entry.lastHead)
      return
    }
    const { head, key } = status
    const lines = await this.allLines(entry.url, head.n)
    const repeated = findDoubleSpend(lines)
    if (repeated !== null) {
      await this.fraud(entry, `line ${repeated} spends a state twice`, head, null)
      return
    }
    if (ledgerRoot(lines.slice(0, head.n).map(hashLine)) !== head.root) {
      await this.fraud(entry, 'lines do not match the head', head, null)
      return
    }
    await this.compare(entry, head)
    await this.store.saveFollowed({
      ...entry,
      lastHead: head,
      current: key,
      countersignature: await this.countersign(entry, head.n, head.root),
    })
  }

  private async countersign(entry: Followed, n: number, root: Hash) {
    const message = witnessMessage(entry.key, n, root)
    return {
      guardian: entry.key,
      n,
      root,
      date: this.now(),
      signature: await this.signer.sign(message),
    }
  }

  private async compare(entry: Followed, head: Head): Promise<FraudProof | null> {
    const seen = await this.store.recordHead(entry.key, head)
    if (seen.root === head.root) return null
    return this.fraud(entry, `two ledgers at line ${head.n}`, head, seen)
  }

  /** Compares a head shown to a client with what this witness has seen. */
  async submit(guardian: Key, head: Head): Promise<{ ok: boolean; fraud: FraudProof | null }> {
    const entry = (await this.store.followed()).find((e) => e.key === guardian)
    if (!entry) return { ok: true, fraud: null }
    const message = headMessage(head.n, head.root)
    if (!verifySignature(entry.current, head.signature, message)) {
      return { ok: false, fraud: null }
    }
    const fraud = await this.compare(entry, head)
    return { ok: fraud === null, fraud }
  }

  async state(): Promise<WitnessGuardian[]> {
    const followed = await this.store.followed()
    return Promise.all(
      followed.map(async (entry) => ({
        key: entry.key,
        url: entry.url,
        last_response: entry.lastAnswer,
        head: entry.countersignature,
        frauds: await this.store.frauds(entry.key),
      })),
    )
  }
}
