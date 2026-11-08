import { describe, expect, it } from 'vitest'
import {
  Mailboxes,
  MemoryMailboxStore,
  Sessions,
  generateSigner,
  sessionMessage,
} from '../src/index.ts'

const CHALLENGE_SECONDS = 120
const SESSION_SECONDS = 3600

function clocked() {
  let now = new Date('2026-11-06T12:00:00.000Z')
  return {
    clock: () => now,
    advance: (seconds: number) => {
      now = new Date(now.getTime() + seconds * 1000)
    },
  }
}

const unauthenticated = { code: 'UNAUTHENTICATED', status: 401 }

describe('sessions', () => {
  it('opens a session for the holder of a key, once per challenge', async () => {
    const sessions = new Sessions()
    const holder = generateSigner()
    const { challenge } = sessions.challenge(holder.key)
    const signature = await holder.sign(sessionMessage(challenge))
    const { session } = sessions.respond({ key: holder.key, challenge, signature })
    expect(() => sessions.require(session, holder.key)).not.toThrow()
    expect(() => sessions.require(session, generateSigner().key)).toThrow()
    expect(() => sessions.require(undefined, holder.key)).toThrow()
    expect(() => sessions.respond({ key: holder.key, challenge, signature })).toThrow()
  })

  it('refuses a signature by another key, or over the bare challenge', async () => {
    const sessions = new Sessions()
    const [holder, other] = [generateSigner(), generateSigner()]
    const first = sessions.challenge(holder.key).challenge
    const forged = await other.sign(sessionMessage(first))
    expect(() =>
      sessions.respond({ key: holder.key, challenge: first, signature: forged }),
    ).toThrow(expect.objectContaining(unauthenticated) as Error)
    const second = sessions.challenge(holder.key).challenge
    const bare = await holder.sign(new TextEncoder().encode(second))
    expect(() =>
      sessions.respond({ key: holder.key, challenge: second, signature: bare }),
    ).toThrow()
  })

  it('expires challenges and sessions', async () => {
    const { clock, advance } = clocked()
    const sessions = new Sessions(clock)
    const holder = generateSigner()
    const late = sessions.challenge(holder.key).challenge
    advance(CHALLENGE_SECONDS)
    const signature = await holder.sign(sessionMessage(late))
    expect(() => sessions.respond({ key: holder.key, challenge: late, signature })).toThrow()

    const fresh = sessions.challenge(holder.key).challenge
    const valid = await holder.sign(sessionMessage(fresh))
    const { session } = sessions.respond({ key: holder.key, challenge: fresh, signature: valid })
    advance(SESSION_SECONDS)
    expect(() => sessions.require(session, holder.key)).toThrow()
    sessions.challenge(holder.key)
    expect(() => sessions.require(session, holder.key)).toThrow()
  })
})

describe('mailboxes', () => {
  it('keeps relay messages and refuses anything else', async () => {
    const date = new Date('2026-11-06T12:00:00.000Z')
    const mailboxes = new Mailboxes(new MemoryMailboxStore(), () => date)
    const scan = generateSigner().key
    const message = { ephemeral: scan, ciphertext: 'AAAA' }
    await expect(mailboxes.deposit(scan, { clear: 'text' })).rejects.toMatchObject({
      code: 'INVALID_FORMAT',
    })
    const { id } = await mailboxes.deposit(scan, message)
    expect(await mailboxes.list(scan)).toEqual([{ id, date: date.toISOString(), content: message }])
    await mailboxes.remove(scan, id)
    expect(await mailboxes.list(scan)).toEqual([])
    expect(await new Mailboxes(new MemoryMailboxStore()).deposit(scan, message)).toEqual({ id: 1 })
  })
})
