import { z } from 'zod'
import { FORMAT } from '../constants.ts'
import { ZERO_HASH, hashOf, sameValue, type Hash } from '../crypto/hash.ts'
import type { Key } from '../crypto/keys.ts'
import { ProtocolError } from '../errors.ts'
import {
  consistencyPath,
  findDoubleSpend,
  hashLine,
  inclusionPath,
  ledgerRoot,
} from '../ledger/line.ts'
import type { GuardianApi, GuardianInfo } from '../model/api.ts'
import type { Announcement, Head, Line, LineType, OwnerEntry, TokenHead } from '../model/ledger.ts'
import type { Group } from '../model/parties.ts'
import {
  parseToken,
  type EntrySignature,
  type GuardianSignature,
  type State,
  type Token,
} from '../model/token.ts'
import { entryMessage, guardianMessage, headMessage } from '../signing/messages.ts'
import { signRotation } from '../signing/rotations.ts'
import { validateToken } from '../token/validity.ts'
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

export interface Integrity {
  ok: boolean
  reason: string | null
}

const TransitionSchema = z.strictObject({ proposal: z.unknown(), previous: z.unknown() })
const CertificateSchema = z.strictObject({ token: z.unknown(), previous: z.unknown() })
const StateHashSchema = z.strictObject({ state_hash: z.string() })

function parseBody<T>(schema: z.ZodType<T>, data: unknown): T {
  const result = schema.safeParse(data)
  if (!result.success) throw new ProtocolError('INVALID_FORMAT', 'invalid request body')
  return result.data
}

const parseTransition = (data: unknown) => {
  const { proposal, previous } = parseBody(TransitionSchema, data)
  return { proposal: parseToken(proposal), previous: parseToken(previous) }
}

const parseCertificate = (data: unknown) => {
  const { token, previous } = parseBody(CertificateSchema, data)
  return { token: parseToken(token), previous: previous ? parseToken(previous) : null }
}

const invalidFormat = (message: string) => new ProtocolError('INVALID_FORMAT', message)

/** The trusted third party: keeps a ledger and votes on transitions (section 8). */
export class Guardian implements GuardianApi {
  readonly url: string
  readonly name: string
  private readonly store: GuardianStore
  private readonly keyring: Keyring
  private readonly clock: () => Date
  private policy: Policy
  private integrity: Integrity = { ok: false, reason: 'not opened' }
  private queue: Promise<unknown> = Promise.resolve()
  private appended = false

  private constructor(config: GuardianConfig) {
    this.url = config.url
    this.name = config.name
    this.store = config.store
    this.keyring = config.keyring
    this.policy = config.policy ?? OPEN_POLICY
    this.clock = config.clock ?? (() => new Date())
  }

  /** Starts a guardian. It locks itself if its ledger no longer matches its published head. */
  static async open(config: GuardianConfig): Promise<Guardian> {
    const guardian = new Guardian(config)
    await guardian.checkIntegrity()
    return guardian
  }

  get key(): Key {
    return this.keyring.current().key
  }

  get locked(): boolean {
    return !this.integrity.ok
  }

  setPolicy(policy: Policy): void {
    this.policy = policy
  }

  // --- Integrity and head ---

  async checkIntegrity(): Promise<Integrity> {
    const lines = await this.store.transaction((tx) => tx.lines(1, Number.MAX_SAFE_INTEGER))
    const head = await this.store.publishedHead()
    const root = ledgerRoot(lines.map(hashLine))
    const fraud = findDoubleSpend(lines)
    let reason: string | null = null
    if (fraud !== null) reason = `line ${fraud} spends a state twice`
    else if (!head && lines.length > 0) reason = 'published head missing'
    else if (head && (head.n !== lines.length || head.root !== root)) {
      reason = 'ledger does not match the published head'
    }
    this.integrity = { ok: reason === null, reason }
    if (reason === null && !head) await this.publish(0, root)
    return this.integrity
  }

  private async publish(n: number, root: Hash): Promise<void> {
    await this.store.publishHead({
      n,
      root,
      date: this.now(),
      signature: await this.keyring.current().sign(headMessage(n, root)),
    })
  }

  async head(): Promise<Head> {
    const head = await this.store.publishedHead()
    if (!head) throw new ProtocolError('LEDGER_LOCKED', 'no published head')
    return this.locked ? { ...head, locked: true } : head
  }

  private now(): string {
    return this.clock().toISOString()
  }

  /** One serialized operation, then the head publication. */
  private write<T>(
    work: (tx: LedgerTransaction) => Promise<T>,
    afterCommit?: () => Promise<void>,
  ): Promise<T> {
    const run = async () => {
      if (this.locked) {
        throw new ProtocolError('LEDGER_LOCKED', 'integrity check failed: not signing')
      }
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

  private read<T>(work: (tx: LedgerTransaction) => Promise<T>): Promise<T> {
    return this.store.transaction(work)
  }

  // --- Public reads ---

  async info(): Promise<GuardianInfo> {
    return {
      key: this.key,
      name: this.name,
      url: this.url,
      version: FORMAT,
      policy: { open: this.policy.creators === null },
      rotations: await this.read((tx) => tx.rotations()),
    }
  }

  lines(from: number, limit: number): Promise<Line[]> {
    return this.read((tx) => tx.lines(from, limit))
  }

  private async hashesUpTo(size: number): Promise<Hash[]> {
    const hashes = await this.read((tx) => tx.lineHashes())
    if (size > hashes.length)
      throw new ProtocolError('UNKNOWN_STATE', 'ledger is shorter than that')
    return hashes.slice(0, size)
  }

  async inclusionProof(line: number, size: number): Promise<Hash[]> {
    return inclusionPath(await this.hashesUpTo(size), line)
  }

  async consistencyProof(from: number, to: number): Promise<Hash[]> {
    return consistencyPath(await this.hashesUpTo(to), from)
  }

  async tokenHead(id: Hash): Promise<TokenHead> {
    const entry = await this.read((tx) => tx.index(id))
    if (!entry) throw new ProtocolError('UNKNOWN_STATE', 'unknown token')
    const { sequence } = entry
    if (entry.here) return { here: true, state_hash: entry.state_hash, n: entry.n, sequence }
    return { here: false, moved_to: entry.moved_to as Group, sequence }
  }

  async announcements(): Promise<Announcement[]> {
    const requests = await this.read((tx) => tx.recoveries())
    return requests.map((r) => ({
      token_id: r.token_id,
      state_hash: r.state_hash,
      claimed_sequence: r.previous.sequence,
      ends_at: r.ends_at,
      status: r.status,
    }))
  }

  private heldTokens(tx: LedgerTransaction): Promise<Token[]> {
    return tx.indexEntries().then(async (entries) => {
      const held = entries.filter((e) => e.here).sort((a, b) => a.n - b.n)
      const tokens = await Promise.all(held.map((e) => tx.token(e.state_hash)))
      return tokens.filter((t) => t !== null)
    })
  }

  owners(from: number, limit: number): Promise<OwnerEntry[]> {
    return this.read(async (tx) => {
      const entries = (await tx.indexEntries())
        .filter((e) => e.here && e.n >= from)
        .sort((a, b) => a.n - b.n)
        .slice(0, limit)
      const tokens = await Promise.all(entries.map((e) => tx.token(e.state_hash)))
      return entries.flatMap((entry, i) => {
        const state = tokens[i]?.state
        if (!state) return []
        const { owner, ephemeral } = state
        return [{ n: entry.n, owner, ...(ephemeral ? { ephemeral } : {}) }]
      })
    })
  }

  /** Session required: the HTTP layer checks that the caller holds `key`. */
  tokensOf(key: Key): Promise<Token[]> {
    return this.read(async (tx) =>
      (await this.heldTokens(tx)).filter((t) => t.state.owner.keys.includes(key)),
    )
  }

  // --- Membership ---

  private async ownKeys(tx: LedgerTransaction): Promise<Set<Key>> {
    return new Set([this.key, ...(await tx.rotations()).map((r) => r.previous)])
  }

  private async belongs(tx: LedgerTransaction, group: Group): Promise<boolean> {
    const keys = await this.ownKeys(tx)
    return group.members.some((m) => keys.has(m.key))
  }

  private async requireOwnUrl(tx: LedgerTransaction, group: Group): Promise<void> {
    const keys = await this.ownKeys(tx)
    const self = group.members.find((m) => keys.has(m.key))
    if (self && self.url !== this.url) throw invalidFormat(`this member's url is ${this.url}`)
  }

  private requireDuration(state: State): void {
    if (!state.expires_at) return
    const seconds = (Date.parse(state.expires_at) - Date.parse(state.date)) / 1000
    if (seconds > this.policy.maxProposalSeconds) {
      throw new ProtocolError('POLICY_REFUSED', 'proposal lasts too long')
    }
  }

  private requireArrival(previous: State): void {
    const { origins } = this.policy
    if (origins && !previous.guardian.members.some((m) => origins.includes(m.key))) {
      throw new ProtocolError('POLICY_REFUSED', 'arrivals from this guardian are refused')
    }
  }

  // --- Recording ---

  private async addLine(
    tx: LedgerTransaction,
    fields: Pick<Line, 'type' | 'token_id' | 'state_hash' | 'spent' | 'origin'>,
  ): Promise<{ n: number; line_hash: Hash }> {
    const line: Line = { n: (await tx.lineCount()) + 1, ...fields, date: this.now() }
    await tx.appendLine(line)
    this.appended = true
    return { n: line.n, line_hash: hashLine(line) }
  }

  private async vote(stateHash: Hash, n: number, lineHash: Hash, tx: LedgerTransaction) {
    const rotations = await tx.rotations()
    const signature: GuardianSignature = {
      type: 'raw',
      key: this.key,
      line: n,
      line_hash: lineHash,
      signature: await this.keyring.current().sign(guardianMessage(stateHash, n, lineHash)),
      ...(rotations.length > 0 ? { rotations } : {}),
    }
    return signature
  }

  private async record(
    tx: LedgerTransaction,
    token: Token,
    type: LineType,
    options: { vote: boolean; spent: Hash | null; origin?: Line['origin'] },
  ): Promise<{ token: Token; n: number }> {
    const { state } = token
    const state_hash = hashOf(state)
    const { n, line_hash } = await this.addLine(tx, {
      type,
      token_id: state.token_id,
      state_hash,
      spent: options.spent,
      origin: options.origin ?? null,
    })
    const complete: Token = options.vote
      ? {
          ...token,
          signatures: {
            ...token.signatures,
            guardians: [
              ...(token.signatures.guardians ?? []),
              await this.vote(state_hash, n, line_hash, tx),
            ],
          },
        }
      : token
    await tx.saveToken(state_hash, complete)
    const here = await this.belongs(tx, state.guardian)
    await tx.saveIndex({
      token_id: state.token_id,
      n,
      state_hash,
      here,
      moved_to: here ? null : state.guardian,
      sequence: state.sequence,
    })
    return { token: complete, n }
  }

  // --- Operations ---

  async create(data: unknown): Promise<Token> {
    const token = parseToken(data)
    const { state, rules } = token
    return this.write(async (tx) => {
      validateToken(token, { stage: 'complete', now: this.clock() })
      if (state.previous !== null) throw invalidFormat('previous must be null at creation')
      if (!(await this.belongs(tx, state.guardian)))
        throw invalidFormat('another guardian is named')
      await this.requireOwnUrl(tx, state.guardian)
      const { creators } = this.policy
      if (creators && !rules.creator.keys.some((k) => creators.includes(k))) {
        throw new ProtocolError('POLICY_REFUSED', 'creator refused by this guardian')
      }
      const existing = await tx.token(hashOf(state))
      if (existing) return existing
      if (await tx.index(state.token_id)) {
        throw new ProtocolError('STATE_ALREADY_SPENT', 'this token already exists')
      }
      return (await this.record(tx, token, 'creation', { vote: true, spent: null })).token
    })
  }

  async validate(data: unknown): Promise<Token> {
    const token = parseToken(data)
    const { state, rules } = token
    return this.write(async (tx) => {
      if (hashOf(rules) !== state.token_id) {
        throw new ProtocolError('RULES_TAMPERED', 'H(rules) does not match token_id')
      }
      if (token.signatures.takeover) throw invalidFormat('a recovery goes through /recovery')
      const entry = await tx.index(state.token_id)
      if (!entry) throw new ProtocolError('UNKNOWN_STATE', 'unknown token')

      const existing = await tx.token(hashOf(state))
      if (existing) return existing

      if (!entry.here) {
        throw new ProtocolError('TOKEN_MOVED', 'token left this guardian', {
          moved_to: entry.moved_to,
        })
      }
      if (state.previous !== entry.state_hash) {
        const known = state.previous !== null && (await tx.token(state.previous)) !== null
        if (known) throw new ProtocolError('STATE_ALREADY_SPENT', 'previous is not the head')
        throw new ProtocolError('UNKNOWN_STATE', 'previous is not in this ledger')
      }
      const previous = (await tx.token(entry.state_hash))?.state
      if (!previous) throw new Error(`missing copy of ${entry.state_hash}`)

      validateToken(token, { stage: 'complete', previous, now: this.clock() })
      this.requireDuration(state)
      await this.requireOwnUrl(tx, state.guardian)
      const type = sameValue(previous.guardian, state.guardian) ? 'transfer' : 'departure'
      return (await this.record(tx, token, type, { vote: true, spent: state.previous })).token
    })
  }

  async enter(data: unknown): Promise<{ incoming_guardian: EntrySignature }> {
    const { proposal, previous } = parseTransition(data)
    const { state } = proposal
    return this.write(async (tx) => {
      if (!(await this.belongs(tx, state.guardian)))
        throw invalidFormat('another guardian is named')
      if (sameValue(previous.state.guardian, state.guardian)) {
        throw invalidFormat('token is already with this group')
      }
      await this.requireOwnUrl(tx, state.guardian)
      validateToken(previous, { stage: 'final' })
      validateToken(proposal, {
        stage: 'proposed',
        previous: previous.state,
        now: this.clock(),
      })
      this.requireDuration(state)
      this.requireArrival(previous.state)

      const entry = await tx.index(state.token_id)
      if (entry?.here && entry.state_hash !== hashOf(previous.state)) {
        throw new ProtocolError('STATE_ALREADY_SPENT', 'another head is held here')
      }
      const state_hash = hashOf(state)
      await tx.saveCommitment({
        state_hash,
        token_id: state.token_id,
        previous: previous.state,
        date: this.now(),
      })
      const rotations = await tx.rotations()
      return {
        incoming_guardian: {
          type: 'raw' as const,
          key: this.key,
          signature: await this.keyring.current().sign(entryMessage(state_hash)),
          ...(rotations.length > 0 ? { rotations } : {}),
        },
      }
    })
  }

  async certify(data: unknown): Promise<{ line: number | null }> {
    const { token, previous } = parseCertificate(data)
    const { state, signatures } = token
    return this.write(async (tx) => {
      if (previous) validateToken(previous, { stage: 'final' })
      validateToken(token, { stage: 'final', previous: previous?.state })

      const member = await this.belongs(tx, state.guardian)
      if (!member && !(previous && (await this.belongs(tx, previous.state.guardian)))) {
        throw invalidFormat('this certificate does not concern this guardian')
      }
      const state_hash = hashOf(state)
      if (await tx.token(state_hash)) await tx.saveToken(state_hash, token)

      const entry = await tx.index(state.token_id)
      if (entry && state.sequence < entry.sequence) return { line: null }
      if (entry?.state_hash === state_hash && (entry.here || !member)) return { line: null }

      if (member && signatures.incoming_guardians?.length) {
        if (!previous) throw invalidFormat('previous is required for an arrival')
        this.requireArrival(previous.state)
        const [signer] = signatures.guardians ?? []
        const consumed = state.previous !== null && (await tx.isConsumed(state.previous))
        const { n } = await this.record(tx, token, 'arrival', {
          vote: false,
          spent: consumed ? null : state.previous,
          origin: signer ? { guardian: signer.key, line: signer.line } : null,
        })
        await tx.deleteCommitment(state_hash)
        return { line: n }
      }
      const { n } = await this.record(tx, token, 'catch_up', { vote: false, spent: null })
      return { line: n }
    })
  }

  // --- Recovery ---

  async requestRecovery(data: unknown): Promise<{ ends_at: string; line: number }> {
    const { proposal, previous } = parseTransition(data)
    const { state, rules, signatures } = proposal
    return this.write(async (tx) => {
      if (!signatures.takeover || !rules.recovery) throw invalidFormat('invalid recovery request')
      validateToken(previous, { stage: 'final' })
      validateToken(proposal, {
        stage: 'proposed',
        previous: previous.state,
        now: this.clock(),
      })
      if (!(await this.belongs(tx, rules.recovery.group))) {
        throw invalidFormat('this guardian is not in the recovery group')
      }
      const state_hash = hashOf(state)
      const open = await tx.recovery(state.token_id)
      if (open && open.status !== 'opposed') {
        if (open.state_hash === state_hash) return { ends_at: open.ends_at, line: open.line }
        throw new ProtocolError('STATE_ALREADY_SPENT', 'a recovery is already open')
      }
      const ends_at = new Date(
        this.clock().getTime() + rules.recovery.delay_seconds * 1000,
      ).toISOString()
      const { n } = await this.addLine(tx, {
        type: 'announcement',
        token_id: state.token_id,
        state_hash,
        spent: null,
        origin: null,
      })
      await tx.saveRecovery({
        token_id: state.token_id,
        state_hash,
        proposal,
        previous: previous.state,
        ends_at,
        status: 'announced',
        line: n,
      })
      return { ends_at, line: n }
    })
  }

  async oppose(data: unknown): Promise<{ line: number }> {
    const { token } = parseCertificate(data)
    const { state } = token
    return this.write(async (tx) => {
      const request = await tx.recovery(state.token_id)
      if (request?.status !== 'announced') {
        throw new ProtocolError('UNKNOWN_STATE', 'no open recovery for this token')
      }
      const claimed = request.previous
      const state_hash = hashOf(state)
      if (state_hash === request.state_hash) {
        throw new ProtocolError('INVALID_SIGNATURE', 'a recovery cannot oppose itself')
      }
      if (state.previous === hashOf(claimed)) {
        validateToken(token, { stage: 'final', previous: claimed })
      } else if (state.sequence > claimed.sequence) {
        validateToken(token, { stage: 'final' })
      } else {
        throw new ProtocolError('INVALID_SIGNATURE', 'this token does not prove a later state')
      }
      const { n } = await this.addLine(tx, {
        type: 'opposition',
        token_id: state.token_id,
        state_hash,
        spent: null,
        origin: null,
      })
      await tx.saveRecovery({ ...request, status: 'opposed' })
      return { line: n }
    })
  }

  async finalizeRecovery(data: unknown): Promise<Token> {
    const { state_hash } = parseBody(StateHashSchema, data)
    return this.write(async (tx) => {
      const request = (await tx.recoveries()).find((r) => r.state_hash === state_hash)
      if (!request) throw new ProtocolError('UNKNOWN_STATE', 'no recovery for this state')
      if (request.status === 'taken_over') {
        const copy = await tx.token(state_hash)
        if (copy) return copy
      }
      if (request.status === 'opposed') {
        throw new ProtocolError('STATE_ALREADY_SPENT', 'this recovery was opposed')
      }
      if (this.clock().getTime() < Date.parse(request.ends_at)) {
        throw new ProtocolError('POLICY_REFUSED', `recovery delay runs until ${request.ends_at}`)
      }
      const { token } = await this.record(tx, request.proposal, 'takeover', {
        vote: true,
        spent: null,
      })
      await tx.saveRecovery({ ...request, status: 'taken_over' })
      return token
    })
  }

  // --- Key rotation ---

  async rotate(): Promise<void> {
    const next = await this.keyring.next()
    const rotation = await signRotation(this.keyring.current(), next)
    await this.write(
      async (tx) => {
        await this.addLine(tx, {
          type: 'rotation',
          token_id: ZERO_HASH,
          state_hash: hashOf(rotation),
          spent: null,
          origin: rotation,
        })
      },
      () => this.keyring.activate(next),
    )
  }
}
