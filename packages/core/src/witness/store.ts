import type { Key } from '../crypto/keys.ts'
import type { KeyVault } from '../guardian/keyring.ts'
import type { Head } from '../model/ledger.ts'
import type { Countersignature, FraudProof } from '../model/responses.ts'

export interface Followed {
  /** The key this guardian was first followed under. */
  key: Key
  url: string
  /** Its key today, after its rotations. */
  current: Key
  lastAnswer: string | null
  lastHead: Head | null
  countersignature: Countersignature | null
}

/** Durable storage of a witness. Every method is atomic. */
export interface WitnessStore {
  followed(): Promise<Followed[]>
  /** Adds or replaces the entry of `key`. */
  saveFollowed(entry: Followed): Promise<void>
  /** Keeps the first head seen at `head.n`, and returns the one kept. */
  recordHead(guardian: Key, head: Head): Promise<Head>
  /** Oldest first. */
  frauds(guardian: Key): Promise<FraudProof[]>
  /** Keeps one proof per guardian, `reason` and `head_a.root`, and returns the one kept. */
  recordFraud(proof: FraudProof): Promise<FraudProof>
}

/** Everything a witness keeps. A storage technology implements this, and nothing else. */
export interface WitnessStorage {
  witness: WitnessStore
  vault: KeyVault
  close(): Promise<void>
}

/** Volatile store for tests and tools. Not durable. */
export class MemoryWitnessStore implements WitnessStore {
  private readonly entries = new Map<Key, Followed>()
  private readonly heads = new Map<string, Head>()
  private readonly proofs: FraudProof[] = []

  followed(): Promise<Followed[]> {
    return Promise.resolve([...this.entries.values()])
  }

  saveFollowed(entry: Followed): Promise<void> {
    this.entries.set(entry.key, entry)
    return Promise.resolve()
  }

  recordHead(guardian: Key, head: Head): Promise<Head> {
    const id = `${guardian}|${head.n}`
    const kept = this.heads.get(id) ?? head
    this.heads.set(id, kept)
    return Promise.resolve(kept)
  }

  frauds(guardian: Key): Promise<FraudProof[]> {
    return Promise.resolve(this.proofs.filter((proof) => proof.guardian === guardian))
  }

  recordFraud(proof: FraudProof): Promise<FraudProof> {
    const known = this.proofs.find(
      (p) =>
        p.guardian === proof.guardian &&
        p.reason === proof.reason &&
        p.head_a.root === proof.head_a.root,
    )
    if (known) return Promise.resolve(known)
    this.proofs.push(proof)
    return Promise.resolve(proof)
  }
}
