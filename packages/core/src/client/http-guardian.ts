import { z } from 'zod'
import type { Hash } from '../crypto/hash.ts'
import type { Key } from '../crypto/keys.ts'
import type { StoredMessage } from '../guardian/mailbox.ts'
import { RelayMessageSchema, type RelayMessage } from '../model/address.ts'
import type { Directory, GuardianApi, GuardianInfo, Submission } from '../model/api.ts'
import type { Head, Line, Notice, OwnerEntry, TokenHead } from '../model/ledger.ts'
import { DateSchema, HashSchema } from '../model/primitives.ts'
import {
  GuardianInfoSchema,
  HeadSchema,
  LineSchema,
  NoticeSchema,
  OwnerEntrySchema,
  TokenHeadSchema,
} from '../model/responses.ts'
import { TransitionSchema, VoteSchema, type Transition, type Vote } from '../model/transition.ts'
import { sessionMessage } from '../signing/messages.ts'
import type { Signer } from '../signing/signer.ts'
import { Transport, segment, type HttpOptions } from './transport.ts'

const Path = z.strictObject({ path: z.array(HashSchema) })
const LineNumber = z.number().int().positive()
const Transitions = z.strictObject({ transitions: z.array(TransitionSchema) })

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
    return (await this.http.get(schema, `/ledger/lines?from=${from}&limit=${limit}`)).lines
  }

  async inclusionProof(line: number, size: number): Promise<Hash[]> {
    return (await this.http.get(Path, `/ledger/proof?line=${line}&size=${size}`)).path
  }

  async consistencyProof(from: number, to: number): Promise<Hash[]> {
    return (await this.http.get(Path, `/ledger/consistency?from=${from}&to=${to}`)).path
  }

  tokenHead(token: Hash): Promise<TokenHead> {
    return this.http.get(TokenHeadSchema, `/tokens/${segment(token)}/head`)
  }

  transition(hash: Hash): Promise<Transition> {
    return this.http.get(TransitionSchema, `/transitions/${segment(hash)}`)
  }

  async claims(output: Hash): Promise<Transition[]> {
    return (await this.http.get(Transitions, `/outputs/${segment(output)}/claims`)).transitions
  }

  validate(submission: Submission): Promise<Transition> {
    return this.http.post(TransitionSchema, '/transitions/validate', submission)
  }

  enter(submission: Submission): Promise<{ incoming_guardian: Vote }> {
    const schema = z.strictObject({ incoming_guardian: VoteSchema })
    return this.http.post(schema, '/transitions/enter', submission)
  }

  certify(submission: Submission): Promise<{ line: number | null }> {
    const schema = z.strictObject({ line: LineNumber.nullable() })
    return this.http.post(schema, '/transitions/certify', submission)
  }

  async notices(): Promise<Notice[]> {
    const schema = z.strictObject({ notices: z.array(NoticeSchema) })
    return (await this.http.get(schema, '/recovery/notices')).notices
  }

  notice(submission: Submission): Promise<{ ends_at: string; line: number }> {
    const schema = z.strictObject({ ends_at: DateSchema, line: LineNumber })
    return this.http.post(schema, '/recovery/notice', submission)
  }

  oppose(submission: Submission): Promise<{ line: number }> {
    return this.http.post(z.strictObject({ line: LineNumber }), '/recovery/oppose', submission)
  }

  async owners(from: number, limit: number): Promise<OwnerEntry[]> {
    const schema = z.strictObject({ owners: z.array(OwnerEntrySchema) })
    return (await this.http.get(schema, `/owners?from=${from}&limit=${limit}`)).owners
  }

  // --- Relay and sessions ---

  /** Proves that the caller holds this key, and returns a session. */
  async authenticate(signer: Signer): Promise<string> {
    const { key } = signer
    const challengeSchema = z.strictObject({ challenge: z.string() })
    const { challenge } = await this.http.post(challengeSchema, '/auth/challenge', { key })
    const signature = await signer.sign(sessionMessage(challenge))
    const sessionSchema = z.strictObject({ session: z.string() })
    const body = { key, challenge, signature }
    return (await this.http.post(sessionSchema, '/auth/response', body)).session
  }

  deposit(scan: Key, message: RelayMessage): Promise<{ id: number }> {
    return this.http.post(
      z.strictObject({ id: z.number().int() }),
      `/mailbox/${segment(scan)}`,
      message,
    )
  }

  async messages(scan: Key, session: string): Promise<StoredMessage[]> {
    const schema = z.strictObject({ messages: z.array(StoredMessageSchema) })
    return (await this.http.get(schema, `/mailbox/${segment(scan)}`, session)).messages
  }

  deleteMessage(scan: Key, id: number, session: string): Promise<void> {
    return this.http.delete(`/mailbox/${segment(scan)}/${id}`, session)
  }

  async outputsOf(key: Key, session: string): Promise<Transition[]> {
    return (await this.http.get(Transitions, `/owners/${segment(key)}/outputs`, session))
      .transitions
  }
}

/** Reaches every guardian over HTTP. This is the `Directory` of a real client. */
export const httpDirectory =
  (options: HttpOptions = {}): Directory =>
  (url) =>
    new HttpGuardian(url, options)
