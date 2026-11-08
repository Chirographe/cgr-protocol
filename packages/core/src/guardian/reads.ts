import type { Hash } from '../crypto/hash.ts'
import type { Key } from '../crypto/keys.ts'
import { unknown } from '../errors.ts'
import { consistencyPath, inclusionPath } from '../ledger/line.ts'
import type { GuardianInfo } from '../model/api.ts'
import type { Line, Notice, OwnerEntry, TokenHead } from '../model/ledger.ts'
import type { Output, Transition } from '../model/transition.ts'
import { predicateKeys } from '../predicate/shape.ts'
import { bodyHash, outputId } from '../transition/ids.ts'
import type { GuardianCore } from './core.ts'
import type { IndexEntry, LedgerTransaction } from './store.ts'

/** The public reads of section 10. */
export class GuardianReads {
  constructor(private readonly core: GuardianCore) {}

  async info(): Promise<GuardianInfo> {
    const { key, name, url, version, policy } = this.core
    const rotations = await this.core.read((tx) => tx.rotations())
    return { key, name, url, version, policy: { open: policy.issuers === null }, rotations }
  }

  lines(from: number, limit: number): Promise<Line[]> {
    return this.core.read((tx) => tx.lines(from, limit))
  }

  private async hashesUpTo(size: number): Promise<Hash[]> {
    const hashes = await this.core.read((tx) => tx.lineHashes())
    if (size > hashes.length) throw unknown('ledger is shorter than that')
    return hashes.slice(0, size)
  }

  async inclusionProof(line: number, size: number): Promise<Hash[]> {
    return inclusionPath(await this.hashesUpTo(size), line)
  }

  async consistencyProof(from: number, to: number): Promise<Hash[]> {
    return consistencyPath(await this.hashesUpTo(to), from)
  }

  async tokenHead(token: Hash): Promise<TokenHead> {
    const entry = await this.core.read((tx) => tx.index(token))
    if (!entry) throw unknown('unknown token')
    const { n, output, sequence } = entry
    return entry.here
      ? { here: true, output, n, sequence }
      : { here: false, moved_to: entry.moved_to, sequence }
  }

  async transition(hash: Hash): Promise<Transition> {
    const found = await this.core.read((tx) => tx.transition(hash))
    if (!found) throw unknown('unknown transition')
    return found
  }

  claims(output: Hash): Promise<Transition[]> {
    return this.core.read(async (tx) => {
      const hashes = await tx.claims(output)
      const found = await Promise.all(hashes.map((hash) => tx.transition(hash)))
      return found.filter((t) => t !== null)
    })
  }

  async notices(): Promise<Notice[]> {
    const records = await this.core.read((tx) => tx.notices())
    return records.map((r) => ({
      token: r.token,
      transition: bodyHash(r.transition),
      sequence: r.sequence,
      ends_at: r.ends_at,
      status: r.status,
    }))
  }

  /** Heads held here, oldest first, with the output each one names. */
  private async heads(
    tx: LedgerTransaction,
  ): Promise<{ entry: IndexEntry; output: Output; transition: Transition }[]> {
    const entries = (await tx.indexEntries()).filter((e) => e.here).sort((a, b) => a.n - b.n)
    const heads = await Promise.all(
      entries.map(async (entry) => {
        const transition = await tx.transition(entry.transition)
        const output = transition?.body.outputs.find((o) => outputId(o) === entry.output)
        return transition && output ? [{ entry, output, transition }] : []
      }),
    )
    return heads.flat()
  }

  owners(from: number, limit: number): Promise<OwnerEntry[]> {
    return this.core.read(async (tx) =>
      (await this.heads(tx))
        .filter(({ entry }) => entry.n >= from)
        .slice(0, limit)
        .map(({ entry, output }) => ({
          n: entry.n,
          ...(output.ephemeral ? { ephemeral: output.ephemeral } : {}),
          keys: predicateKeys(output.lock),
        })),
    )
  }

  /** Session required: the HTTP layer checks that the caller holds `key`. */
  outputsOf(key: Key): Promise<Transition[]> {
    return this.core.read(async (tx) =>
      (await this.heads(tx))
        .filter(({ output }) => predicateKeys(output.lock).includes(key))
        .map(({ transition }) => transition),
    )
  }
}
