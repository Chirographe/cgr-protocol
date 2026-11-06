import cors from '@fastify/cors'
import Fastify, { type FastifyInstance } from 'fastify'
import type { z } from 'zod'
import { ProtocolError } from '@chirographe/core'

const BODY_LIMIT = 1024 * 1024
// A p256 key in a URL is over Fastify's default limit of 100 characters.
const MAX_PARAM_LENGTH = 2048

export interface HttpOptions {
  /** Web origins allowed to call this server from a browser. */
  corsOrigins?: string[]
  /** Set behind a reverse proxy, so that rate limits apply to clients and not to the proxy. */
  trustProxy?: boolean
}

export function parse<T>(schema: z.ZodType<T>, data: unknown): T {
  const result = schema.safeParse(data)
  if (!result.success) {
    throw new ProtocolError('INVALID_FORMAT', result.error.issues[0]?.message ?? 'invalid request')
  }
  return result.data
}

export async function createHttpServer(options: HttpOptions): Promise<FastifyInstance> {
  const app = Fastify({
    logger: false,
    bodyLimit: BODY_LIMIT,
    trustProxy: options.trustProxy ?? false,
    routerOptions: { maxParamLength: MAX_PARAM_LENGTH },
  })
  await app.register(cors, {
    origin: options.corsOrigins ?? false,
    methods: ['GET', 'POST', 'DELETE'],
  })

  app.setErrorHandler((error: Error & { statusCode?: number }, _request, reply) => {
    if (error instanceof ProtocolError) {
      const { code, message, details, status } = error
      return reply.status(status).send({ ...details, error: code, message })
    }
    if (error.statusCode && error.statusCode < 500) {
      return reply.status(400).send({ error: 'INVALID_FORMAT', message: error.message })
    }
    console.error(error)
    return reply.status(500).send({ error: 'INTERNAL', message: 'internal error' })
  })

  app.setNotFoundHandler((_request, reply) =>
    reply.status(404).send({ error: 'UNKNOWN_STATE', message: 'unknown route' }),
  )

  return app
}

/** Counts per client and per minute. Throws once a client goes over `limit`. */
export function rateLimit(limit: number, now: () => number = Date.now) {
  let minute = 0
  let counts = new Map<string, number>()
  return (client: string): void => {
    const current = Math.floor(now() / 60_000)
    if (current !== minute) {
      minute = current
      counts = new Map()
    }
    const count = (counts.get(client) ?? 0) + 1
    counts.set(client, count)
    if (count > limit) {
      throw new ProtocolError('TOO_MANY_REQUESTS', 'too many requests, try again in a minute')
    }
  }
}
