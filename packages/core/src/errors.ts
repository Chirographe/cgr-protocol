import type { z } from 'zod'

export const ERROR_STATUS = {
  INVALID_FORMAT: 400,
  NOT_AUTHORIZED: 400,
  EXPIRED: 400,
  UNAUTHENTICATED: 401,
  POLICY_REFUSED: 403,
  UNKNOWN: 404,
  ALREADY_SPENT: 409,
  TOKEN_MOVED: 409,
  TOO_MANY_REQUESTS: 429,
  LEDGER_LOCKED: 503,
} as const

export type ErrorCode = keyof typeof ERROR_STATUS

/** An error defined by the protocol, sent to clients as `{ error, message }`. */
export class ProtocolError extends Error {
  override readonly name = 'ProtocolError'

  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message)
  }

  get status(): number {
    return ERROR_STATUS[this.code]
  }
}

export const invalidFormat = (message: string) => new ProtocolError('INVALID_FORMAT', message)
export const notAuthorized = (message: string) => new ProtocolError('NOT_AUTHORIZED', message)
export const unknown = (message: string) => new ProtocolError('UNKNOWN', message)
export const alreadySpent = (message: string) => new ProtocolError('ALREADY_SPENT', message)
export const policyRefused = (message: string) => new ProtocolError('POLICY_REFUSED', message)

/** Parses untrusted input, or throws `INVALID_FORMAT` with the first issue. */
export function parseWith<T>(schema: z.ZodType<T>, data: unknown, what: string): T {
  const result = schema.safeParse(data)
  if (result.success) return result.data
  throw invalidFormat(result.error.issues[0]?.message ?? `invalid ${what}`)
}
