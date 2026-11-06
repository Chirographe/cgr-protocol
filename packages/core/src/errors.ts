export const ERROR_STATUS = {
  INVALID_FORMAT: 400,
  RULES_TAMPERED: 400,
  INVALID_SIGNATURE: 400,
  PROPOSAL_EXPIRED: 400,
  UNAUTHENTICATED: 401,
  GUARDIAN_NOT_ALLOWED: 403,
  POLICY_REFUSED: 403,
  UNKNOWN_STATE: 404,
  STATE_ALREADY_SPENT: 409,
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
