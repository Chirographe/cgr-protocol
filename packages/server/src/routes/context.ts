import type { FastifyInstance } from 'fastify'
import type { Guardian, Mailboxes, Sessions } from '@chirographe/core'

/** What the route modules of a guardian share. */
export interface GuardianContext {
  app: FastifyInstance
  guardian: Guardian
  mailboxes: Mailboxes
  sessions: Sessions
  /** Throws `TOO_MANY_REQUESTS` once this client is over its limit. */
  limit: (client: string) => void
}
