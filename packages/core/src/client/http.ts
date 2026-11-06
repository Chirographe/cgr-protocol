import { z } from 'zod'
import type { Hash } from '../crypto/hash.ts'
import type { Key } from '../crypto/keys.ts'
import { decodeBase64Url } from '../encoding/base64url.ts'
import { ERROR_STATUS, ProtocolError, type ErrorCode } from '../errors.ts'
import type { StoredMessage } from '../guardian/mailbox.ts'
import { RelayMessageSchema, type RelayMessage } from '../model/address.ts'
import type { Certificate, Directory, GuardianApi, GuardianInfo, Transition } from '../model/api.ts'
import type { Announcement, Head, Line, OwnerEntry, TokenHead } from '../model/ledger.ts'
import {
  AnnouncementSchema,
  FraudProofSchema,
  GuardianInfoSchema,
  HeadSchema,
  LineSchema,
  OwnerEntrySchema,
  TokenHeadSchema,
  WitnessGuardianSchema,
  type FraudProof,
  type WitnessGuardian,
} from '../model/responses.ts'
import { DateSchema, HashSchema, KeySchema } from '../model/primitives.ts'
import {
  EntrySignatureSchema,
  TokenSchema,
  type EntrySignature,
  type Token,
} from '../model/token.ts'
import type { Signer } from '../signing/signer.ts'

/** Any function with the shape of the standard `fetch`. */
export type Fetch = (url: string, init: RequestInit) => Promise<Response>

export interface HttpOptions {
  /** Defaults to the global `fetch`. */
  fetch?: Fetch
  /** A member that hangs must not hold up a quorum call. */
  timeoutSeconds?: number
}

const DEFAULT_TIMEOUT_SECONDS = 10

const Path = z.strictObject({ path: z.array(HashSchema) })
const LineNumber = z.number().int().positive()

const segment = encodeURIComponent

function errorFrom(status: number, data: unknown, url: string): Error {
  const { success, data: body } = z
    .looseObject({ error: z.string(), message: z.string() })
    .safeParse(data)
  if (!success || !Object.hasOwn(ERROR_STATUS, body.error)) {
    return new Error(`HTTP ${status} from ${url}`)
  }
  const { error, message, ...details } = body
  return new ProtocolError(error as ErrorCode, message, details)
}

class Transport {
  private readonly base: string
  private readonly fetch: Fetch
  private readonly timeout: number

  constructor(url: string, options: HttpOptions) {
    this.base = url.replace(/\/+$/, '')
    this.fetch = options.fetch ?? ((target, init) => globalThis.fetch(target, init))
    this.timeout = (options.timeoutSeconds ?? DEFAULT_TIMEOUT_SECONDS) * 1000
  }

  private async send(path: string, init: RequestInit): Promise<unknown> {
    const url = `${this.base}${path}`
    const response = await this.fetch(url, { ...init, signal: AbortSignal.timeout(this.timeout) })
    const data: unknown = await response.json().catch(() => null)
    if (!response.ok) throw errorFrom(response.status, data, url)
    return data
  }

  /** The answer of a server is untrusted input, like any other. */
  private read<T>(schema: z.ZodType<T>, data: unknown, path: string): T {
    const parsed = schema.safeParse(data)
    if (!parsed.success) throw new Error(`invalid answer from ${this.base}${path}`)
    return parsed.data
  }

  async get<T>(schema: z.ZodType<T>, path: string, session?: string): Promise<T> {
    const headers = session ? { authorization: `Bearer ${session}` } : undefined
    return this.read(schema, await this.send(path, { headers }), path)
  }

  async post<T>(schema: z.ZodType<T>, path: string, body: unknown): Promise<T> {
    const init = {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }
    return this.read(schema, await this.send(path, init), path)
  }

  async delete(path: string, session: string): Promise<void> {
    const headers = { authorization: `Bearer ${session}` }
    await this.send(path, { method: 'DELETE', headers })
  }
}

const StoredMessageSchema: z.ZodType<StoredMessage> = z.strictObject({
  id: z.number().int(),
  date: DateSchema,
  content: RelayMessageSchema,
})

/** A guardian reached over HTTP, on any runtime that has `fetch`. */
export class HttpGuardian implements GuardianApi {
  private readonly http: Transport

  constructor(url: string, options: HttpOptions = {}) {
    this.http = new Transport(url, options)
  }

  info(): Promise<GuardianInfo> {
    return this.http.get(GuardianInfoSchema, '/.well-known/guardian')
  }

  head(): Promise<Head> {
    return this.http.get(HeadSchema, '/ledger/head')
  }

  async lines(from: number, limit: number): Promise<Line[]> {
    const schema = z.strictObject({ lines: z.array(LineSchema) })
    const path = `/ledger/lines?from=${from}&limit=${limit}`
    return (await this.http.get(schema, path)).lines
  }

  async inclusionProof(line: number, size: number): Promise<Hash[]> {
    return (await this.http.get(Path, `/ledger/proof?line=${line}&size=${size}`)).path
  }

  async consistencyProof(from: number, to: number): Promise<Hash[]> {
    return (await this.http.get(Path, `/ledger/consistency?from=${from}&to=${to}`)).path
  }

  tokenHead(id: Hash): Promise<TokenHead> {
    return this.http.get(TokenHeadSchema, `/tokens/${segment(id)}/head`)
  }

  create(token: Token): Promise<Token> {
    return this.http.post(TokenSchema, '/tokens/create', token)
  }

  validate(token: Token): Promise<Token> {
    return this.http.post(TokenSchema, '/tokens/validate', token)
  }

  enter(transition: Transition): Promise<{ incoming_guardian: EntrySignature }> {
    const schema = z.strictObject({ incoming_guardian: EntrySignatureSchema })
    return this.http.post(schema, '/tokens/enter', transition)
  }

  certify(certificate: Certificate): Promise<{ line: number | null }> {
    const schema = z.strictObject({ line: LineNumber.nullable() })
    return this.http.post(schema, '/tokens/certify', certificate)
  }

  async announcements(): Promise<Announcement[]> {
    const schema = z.strictObject({ announcements: z.array(AnnouncementSchema) })
    return (await this.http.get(schema, '/recovery/announcements')).announcements
  }

  requestRecovery(transition: Transition): Promise<{ ends_at: string; line: number }> {
    const schema = z.strictObject({ ends_at: DateSchema, line: LineNumber })
    return this.http.post(schema, '/recovery/request', transition)
  }

  oppose(certificate: Certificate): Promise<{ line: number }> {
    return this.http.post(z.strictObject({ line: LineNumber }), '/recovery/oppose', certificate)
  }

  finalizeRecovery(request: { state_hash: Hash }): Promise<Token> {
    return this.http.post(TokenSchema, '/recovery/finalize', request)
  }

  async owners(from: number, limit: number): Promise<OwnerEntry[]> {
    const schema = z.strictObject({ owners: z.array(OwnerEntrySchema) })
    return (await this.http.get(schema, `/owners?from=${from}&limit=${limit}`)).owners
  }

  // --- Relay and sessions ---

  /** Proves that the caller holds this key, and returns a session. */
  async authenticate(signer: Signer): Promise<string> {
    const { key } = signer
    const { challenge } = await this.http.post(
      z.strictObject({ challenge: z.string() }),
      '/auth/challenge',
      { key },
    )
    const signature = await signer.sign(decodeBase64Url(challenge))
    const { session } = await this.http.post(
      z.strictObject({ session: z.string() }),
      '/auth/response',
      { key, challenge, signature },
    )
    return session
  }

  deposit(scan: Key, message: RelayMessage): Promise<{ id: number }> {
    const schema = z.strictObject({ id: z.number().int() })
    return this.http.post(schema, `/mailbox/${segment(scan)}`, message)
  }

  async messages(scan: Key, session: string): Promise<StoredMessage[]> {
    const schema = z.strictObject({ messages: z.array(StoredMessageSchema) })
    return (await this.http.get(schema, `/mailbox/${segment(scan)}`, session)).messages
  }

  deleteMessage(scan: Key, id: number, session: string): Promise<void> {
    return this.http.delete(`/mailbox/${segment(scan)}/${id}`, session)
  }

  async tokensOf(key: Key, session: string): Promise<Token[]> {
    const schema = z.strictObject({ tokens: z.array(TokenSchema) })
    return (await this.http.get(schema, `/owners/${segment(key)}/tokens`, session)).tokens
  }
}

/** Reaches every guardian over HTTP. This is the `Directory` of a real client. */
export const httpDirectory =
  (options: HttpOptions = {}): Directory =>
  (url) =>
    new HttpGuardian(url, options)

/** A witness reached over HTTP. */
export class HttpWitness {
  private readonly http: Transport

  constructor(url: string, options: HttpOptions = {}) {
    this.http = new Transport(url, options)
  }

  info(): Promise<{ key: Key; name: string }> {
    const schema = z.strictObject({ key: KeySchema, name: z.string() })
    return this.http.get(schema, '/.well-known/witness')
  }

  async guardians(): Promise<WitnessGuardian[]> {
    const schema = z.strictObject({ guardians: z.array(WitnessGuardianSchema) })
    return (await this.http.get(schema, '/guardians')).guardians
  }

  submitHead(guardian: Key, head: Head): Promise<{ ok: boolean; fraud: FraudProof | null }> {
    const schema = z.strictObject({ ok: z.boolean(), fraud: FraudProofSchema.nullable() })
    return this.http.post(schema, '/heads', { guardian, head })
  }
}
