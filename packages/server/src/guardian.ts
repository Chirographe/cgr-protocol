import type { FastifyInstance, FastifyRequest } from 'fastify'
import { z } from 'zod'
import {
  Base64UrlSchema,
  HashSchema,
  KeySchema,
  Sessions,
  type Guardian,
  type Key,
  type Mailboxes,
} from '@chirographe/core'
import { createHttpServer, parse, rateLimit, type HttpOptions } from './http.ts'

const MESSAGE_LIMIT = 256 * 1024
const MAX_PAGE = 500
const DEFAULT_REQUESTS_PER_MINUTE = 60

const Number_ = z.coerce.number().int()
const Page = z.object({
  from: Number_.positive().default(1),
  limit: Number_.positive().max(MAX_PAGE).default(MAX_PAGE),
})
const InclusionQuery = z
  .object({ line: Number_.positive(), size: Number_.positive() })
  .refine(({ line, size }) => line <= size, 'line is past size')
const ConsistencyQuery = z
  .object({ from: Number_.nonnegative(), to: Number_.nonnegative() })
  .refine(({ from, to }) => from <= to, 'from is past to')
const TokenParams = z.object({ id: HashSchema })
const ScanParams = z.object({ scan: KeySchema })
const MessageParams = ScanParams.extend({ id: Number_ })
const OwnerParams = z.object({ key: KeySchema })
const ChallengeBody = z.strictObject({ key: KeySchema })
const ResponseBody = z.strictObject({
  key: KeySchema,
  challenge: Base64UrlSchema,
  signature: Base64UrlSchema,
})

export interface GuardianServerOptions extends HttpOptions {
  guardian: Guardian
  mailboxes: Mailboxes
  sessions?: Sessions
  /** Per client, for the routes open to anyone that cost storage or memory. */
  requestsPerMinute?: number
}

/** Section 10 over HTTP. Every rule lives in `Guardian`: this layer only carries requests. */
export async function createGuardianServer(
  options: GuardianServerOptions,
): Promise<FastifyInstance> {
  const { guardian, mailboxes, sessions = new Sessions() } = options
  const app = await createHttpServer(options)
  const limit = rateLimit(options.requestsPerMinute ?? DEFAULT_REQUESTS_PER_MINUTE)

  const requireSession = (request: FastifyRequest, key: Key) =>
    sessions.require(request.headers.authorization?.replace(/^Bearer /, ''), key)

  // --- Ledger ---

  app.get('/.well-known/guardian', () => guardian.info())

  app.get('/ledger/head', () => guardian.head())

  app.get('/ledger/lines', async (request) => {
    const { from, limit } = parse(Page, request.query)
    return { lines: await guardian.lines(from, limit) }
  })

  app.get('/ledger/proof', async (request) => {
    const { line, size } = parse(InclusionQuery, request.query)
    return { path: await guardian.inclusionProof(line, size) }
  })

  app.get('/ledger/consistency', async (request) => {
    const { from, to } = parse(ConsistencyQuery, request.query)
    return { path: await guardian.consistencyProof(from, to) }
  })

  // --- Tokens ---

  app.get('/tokens/:id/head', (request) =>
    guardian.tokenHead(parse(TokenParams, request.params).id),
  )

  app.post('/tokens/create', async (request, reply) =>
    reply.status(201).send(await guardian.create(request.body)),
  )
  app.post('/tokens/validate', (request) => guardian.validate(request.body))
  app.post('/tokens/enter', (request) => guardian.enter(request.body))
  app.post('/tokens/certify', (request) => guardian.certify(request.body))

  // --- Recovery ---

  app.get('/recovery/announcements', async () => ({
    announcements: await guardian.announcements(),
  }))
  app.post('/recovery/request', (request) => guardian.requestRecovery(request.body))
  app.post('/recovery/oppose', (request) => guardian.oppose(request.body))
  app.post('/recovery/finalize', (request) => guardian.finalizeRecovery(request.body))

  // --- Relay ---

  app.post('/mailbox/:scan', { bodyLimit: MESSAGE_LIMIT }, async (request, reply) => {
    limit(request.ip)
    const { scan } = parse(ScanParams, request.params)
    return reply.status(201).send(await mailboxes.deposit(scan, request.body))
  })

  app.get('/mailbox/:scan', async (request) => {
    const { scan } = parse(ScanParams, request.params)
    requireSession(request, scan)
    return { messages: await mailboxes.list(scan) }
  })

  app.delete('/mailbox/:scan/:id', async (request) => {
    const { scan, id } = parse(MessageParams, request.params)
    requireSession(request, scan)
    await mailboxes.remove(scan, id)
    return { ok: true }
  })

  // --- Sessions and wallet recovery ---

  app.post('/auth/challenge', (request) => {
    limit(request.ip)
    return Promise.resolve(sessions.challenge(parse(ChallengeBody, request.body).key))
  })

  app.post('/auth/response', (request) => {
    limit(request.ip)
    return Promise.resolve(sessions.respond(parse(ResponseBody, request.body)))
  })

  app.get('/owners', async (request) => {
    const { from, limit } = parse(Page, request.query)
    return { owners: await guardian.owners(from, limit) }
  })

  app.get('/owners/:key/tokens', async (request) => {
    const { key } = parse(OwnerParams, request.params)
    requireSession(request, key)
    return { tokens: await guardian.tokensOf(key) }
  })

  return app
}
