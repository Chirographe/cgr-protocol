import { z } from 'zod'
import { ERROR_STATUS, ProtocolError, type ErrorCode } from '../errors.ts'

/** Any function with the shape of the standard `fetch`. */
export type Fetch = (url: string, init: RequestInit) => Promise<Response>

export interface HttpOptions {
  /** Defaults to the global `fetch`. */
  fetch?: Fetch
  /** A member that hangs must not hold up a quorum call. */
  timeoutSeconds?: number
}

const DEFAULT_TIMEOUT_SECONDS = 10

export const segment = encodeURIComponent

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

/** JSON over HTTP. Every answer is untrusted input and goes through a schema. */
export class Transport {
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
    await this.send(path, { method: 'DELETE', headers: { authorization: `Bearer ${session}` } })
  }
}
