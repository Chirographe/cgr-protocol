import type { FastifyInstance } from 'fastify'
import {
  Sessions,
  registerScheme,
  type Guardian,
  type Mailboxes,
  type MembershipScheme,
} from '@chirographe/core'
import { createHttpServer, rateLimit, type HttpOptions } from './http.ts'
import { operationRoutes } from './routes/operations.ts'
import { readRoutes } from './routes/reads.ts'
import { relayRoutes } from './routes/relay.ts'

export const DEFAULT_REQUESTS_PER_MINUTE = 60

export interface GuardianServerOptions extends HttpOptions {
  guardian: Guardian
  mailboxes: Mailboxes
  sessions?: Sessions
  /** Per client, for the routes open to anyone that cost storage or memory. */
  requestsPerMinute?: number
  /** Proof systems `member` predicates may name, registered once at startup. */
  schemes?: MembershipScheme[]
}

/** Section 10 over HTTP. Every rule lives in `Guardian`: this layer only carries requests. */
export async function createGuardianServer(
  options: GuardianServerOptions,
): Promise<FastifyInstance> {
  for (const scheme of options.schemes ?? []) registerScheme(scheme)
  const app = await createHttpServer(options)
  const context = {
    app,
    guardian: options.guardian,
    mailboxes: options.mailboxes,
    sessions: options.sessions ?? new Sessions(),
    limit: rateLimit(options.requestsPerMinute ?? DEFAULT_REQUESTS_PER_MINUTE),
  }
  readRoutes(context)
  operationRoutes(context)
  relayRoutes(context)
  return app
}
