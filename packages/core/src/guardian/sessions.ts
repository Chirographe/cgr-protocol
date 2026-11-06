import { verifySignature, type Key } from '../crypto/keys.ts'
import { decodeBase64Url, encodeBase64Url } from '../encoding/base64url.ts'
import { randomBytes } from '../encoding/bytes.ts'
import { ProtocolError } from '../errors.ts'

const CHALLENGE_BYTES = 32
const CHALLENGE_SECONDS = 120
const SESSION_SECONDS = 3600

const unauthenticated = () => new ProtocolError('UNAUTHENTICATED', 'missing or expired session')

/** Proof of key ownership for mailboxes and wallet recovery. State is held in memory. */
export class Sessions {
  private readonly challenges = new Map<string, { key: Key; expires: number }>()
  private readonly sessions = new Map<string, { key: Key; expires: number }>()

  constructor(private readonly clock: () => Date = () => new Date()) {}

  private later(seconds: number): number {
    return this.clock().getTime() + seconds * 1000
  }

  challenge(key: Key): { challenge: string } {
    const challenge = encodeBase64Url(randomBytes(CHALLENGE_BYTES))
    this.challenges.set(challenge, { key, expires: this.later(CHALLENGE_SECONDS) })
    return { challenge }
  }

  respond(request: { key: Key; challenge: string; signature: string }): { session: string } {
    const pending = this.challenges.get(request.challenge)
    this.challenges.delete(request.challenge)
    const valid =
      pending?.key === request.key &&
      pending.expires > this.clock().getTime() &&
      verifySignature(request.key, request.signature, decodeBase64Url(request.challenge))
    if (!valid) throw unauthenticated()
    const session = encodeBase64Url(randomBytes(CHALLENGE_BYTES))
    this.sessions.set(session, { key: request.key, expires: this.later(SESSION_SECONDS) })
    return { session }
  }

  require(session: string | undefined, key: Key): void {
    const entry = session ? this.sessions.get(session) : undefined
    if (entry?.key !== key || entry.expires <= this.clock().getTime()) throw unauthenticated()
  }
}
