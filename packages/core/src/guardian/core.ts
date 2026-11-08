import { FORMAT } from '../constants.ts'
import type { Hash } from '../crypto/hash.ts'
import type { Key } from '../crypto/keys.ts'
import { ProtocolError, invalidFormat } from '../errors.ts'
import { hashLine, ledgerRoot } from '../ledger/line.ts'
import type { Group } from '../model/group.ts'
import type { Head, Line } from '../model/ledger.ts'
import type { Vote } from '../model/transition.ts'
import { headMessage } from '../signing/messages.ts'
import { ledgerMismatch } from './integrity.ts'
import type { Keyring } from './keyring.ts'
import { OPEN_POLICY, type Policy } from './policy.ts'
import type { GuardianStore, LedgerTransaction } from './store.ts'

export interface GuardianConfig {
  name: string
  url: string
  store: GuardianStore
  keyring: Keyring
  policy?: Policy
  clock?: () => Date
}

/** What every guardian operation shares: identity, clock, and the serialized ledger. */
export class GuardianCore {
  readonly name: string
  readonly url: string
  readonly version = FORMAT
  readonly store: GuardianStore
  readonly keyring: Keyring
  readonly clock: () => Date
  policy: Policy
  private lockedReason: string | null = 'not opened'
  private queue: Promise<unknown> = Promise.resolve()
  private appended = false

  constructor(config: GuardianConfig) {
    this.name = config.name
    this.url = config.url
    this.store = config.store
    this.keyring = config.keyring
    this.policy = config.policy ?? OPEN_POLICY
    this.clock = config.clock ?? (() => new Date())
  }

  get key(): Key {
    return this.keyring.current().key
  }

  get locked(): boolean {
    return this.lockedReason !== null
  }

  now = (): string => this.clock().toISOString()

  // --- Integrity ---

  /** Section 8: checks the ledger against its head, finishing a crash before publication. */
  async open(): Promise<void> {
    const { lines, rotations } = await this.read(async (tx) => ({
      lines: await tx.lines(1, Number.MAX_SAFE_INTEGER),
      rotations: await tx.rotations(),
    }))
    const head = await this.store.publishedHead()
    const keys = [this.key, ...rotations.flatMap((r) => [r.previous, r.next])]
    let reason = ledgerMismatch(lines, head, keys)
    const unpublished = lines.length > (head?.n ?? 0)
    if (reason === null && unpublished) reason = await this.finishRotation(lines, rotations.at(-1))
    this.lockedReason = reason
    if (reason === null && (!head || unpublished)) {
      await this.publish(lines.length, ledgerRoot(lines.map(hashLine)))
    }
  }

  /** The crash may have come after a rotation line, and before the switch to its key. */
  private async finishRotation(
    lines: Line[],
    rotation: { next: Key } | undefined,
  ): Promise<string | null> {
    if (lines.at(-1)?.type !== 'rotation' || !rotation || rotation.next === this.key) return null
    const pending = await this.keyring.pending()
    if (pending?.key !== rotation.next) return 'the key of the last rotation is lost'
    await this.keyring.activate(pending)
    return null
  }

  private async publish(n: number, root: Hash): Promise<void> {
    const signature = await this.keyring.current().sign(headMessage(n, root))
    await this.store.publishHead({ n, root, date: this.now(), signature })
  }

  async head(): Promise<Head> {
    const head = await this.store.publishedHead()
    if (!head) throw new ProtocolError('LEDGER_LOCKED', 'no published head')
    return this.locked ? { ...head, locked: true } : head
  }

  // --- Transactions ---

  read<T>(work: (tx: LedgerTransaction) => Promise<T>): Promise<T> {
    return this.store.transaction(work)
  }

  /** One serialized operation, then the head publication. */
  write<T>(
    work: (tx: LedgerTransaction) => Promise<T>,
    afterCommit?: () => Promise<void>,
  ): Promise<T> {
    const run = async () => {
      if (this.locked)
        throw new ProtocolError('LEDGER_LOCKED', 'integrity check failed: not signing')
      this.appended = false
      const { result, hashes } = await this.store.transaction(async (tx) => ({
        result: await work(tx),
        hashes: await tx.lineHashes(),
      }))
      await afterCommit?.()
      if (this.appended) await this.publish(hashes.length, ledgerRoot(hashes))
      return result
    }
    const next = this.queue.then(run, run)
    this.queue = next.catch(() => undefined)
    return next
  }

  async addLine(tx: LedgerTransaction, fields: Omit<Line, 'n' | 'date'>): Promise<Line> {
    const line: Line = { n: (await tx.lineCount()) + 1, ...fields, date: this.now() }
    await tx.appendLine(line)
    this.appended = true
    return line
  }

  /** A signature of this guardian, carrying its rotations. */
  async sign(tx: LedgerTransaction, message: Uint8Array, line?: Line): Promise<Vote> {
    const rotations = await tx.rotations()
    return {
      type: 'raw',
      key: this.key,
      signature: await this.keyring.current().sign(message),
      ...(line ? { line: line.n, line_hash: hashLine(line) } : {}),
      ...(rotations.length > 0 ? { rotations } : {}),
    }
  }

  // --- Membership ---

  async ownKeys(tx: LedgerTransaction): Promise<Set<Key>> {
    return new Set([this.key, ...(await tx.rotations()).map((r) => r.previous)])
  }

  /** Belongs under any of its keys, with its own url (section 8). */
  async belongs(tx: LedgerTransaction, group: Group): Promise<boolean> {
    const keys = await this.ownKeys(tx)
    const self = group.members.find((m) => keys.has(m.key))
    if (self && self.url !== this.url) throw invalidFormat(`this member's url is ${this.url}`)
    return self !== undefined
  }

  async requireMember(tx: LedgerTransaction, group: Group): Promise<void> {
    if (!(await this.belongs(tx, group))) throw invalidFormat('this guardian is not in the group')
  }
}
