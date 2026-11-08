import type { FastifyRequest } from 'fastify'
import type { Key } from '@chirographe/core'
import { parse } from '../http.ts'
import type { GuardianContext } from './context.ts'
import {
  ChallengeBody,
  MessageParams,
  OwnerParams,
  Page,
  ResponseBody,
  ScanParams,
} from './queries.ts'

/** A relay message is small: it carries a transition and the few that produced its inputs. */
const MESSAGE_LIMIT = 256 * 1024
const BEARER = /^Bearer /
const CREATED = 201

/** Mailboxes, sessions and wallet recovery (sections 5 and 10). */
export function relayRoutes({ app, guardian, mailboxes, sessions, limit }: GuardianContext): void {
  const requireSession = (request: FastifyRequest, key: Key) =>
    sessions.require(request.headers.authorization?.replace(BEARER, ''), key)

  app.post('/mailbox/:scan', { bodyLimit: MESSAGE_LIMIT }, async (request, reply) => {
    limit(request.ip)
    const { scan } = parse(ScanParams, request.params)
    return reply.status(CREATED).send(await mailboxes.deposit(scan, request.body))
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

  app.post('/auth/challenge', (request) => {
    limit(request.ip)
    return Promise.resolve(sessions.challenge(parse(ChallengeBody, request.body).key))
  })

  app.post('/auth/response', (request) => {
    limit(request.ip)
    return Promise.resolve(sessions.respond(parse(ResponseBody, request.body)))
  })

  app.get('/owners', async (request) => {
    const { from, limit: count } = parse(Page, request.query)
    return { owners: await guardian.owners(from, count) }
  })

  app.get('/owners/:key/outputs', async (request) => {
    const { key } = parse(OwnerParams, request.params)
    requireSession(request, key)
    return { transitions: await guardian.outputsOf(key) }
  })
}
