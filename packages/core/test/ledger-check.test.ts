import { describe, expect, it } from 'vitest'
import {
  bodyHash,
  checkLedger,
  checkVoteLine,
  generateSigner,
  hashOf,
  type GuardianApi,
  type Vote,
} from '../src/index.ts'
import { Network } from './support/network.ts'
import { mint, people, transfer } from './support/tokens.ts'

const { alice } = people('alice')

async function setup() {
  const net = new Network()
  const group = await net.group(['a'], 1)
  const minted = await mint(net, { group, owner: alice! })
  const moved = await transfer(net, minted, [alice!])
  const guardian = net.node('a').guardian
  return { guardian, transition: moved.transition, vote: moved.transition.guardians![0]! }
}

const altered = (guardian: GuardianApi, changes: Partial<GuardianApi>): GuardianApi =>
  new Proxy(guardian, {
    get: (target, name: keyof GuardianApi) => changes[name] ?? target[name],
  })

describe('ledger check', () => {
  it('passes for an honest guardian, then for a head that extends it', async () => {
    const { guardian } = await setup()
    const first = await checkLedger(guardian, guardian.key, null)
    expect(first.ok).toBe(true)
    if (!first.ok) return
    expect(await checkLedger(guardian, guardian.key, first.head)).toMatchObject({ ok: true })
  })

  it('fails on a locked guardian, a broken rotation, or a foreign signature', async () => {
    const { guardian } = await setup()
    const head = await guardian.head()
    const locked = altered(guardian, { head: () => Promise.resolve({ ...head, locked: true }) })
    expect(await checkLedger(locked, guardian.key, null)).toEqual({
      ok: false,
      reason: 'guardian is locked',
    })

    const info = await guardian.info()
    const rotation = {
      previous: guardian.key,
      next: generateSigner().key,
      previous_signature: 'AAAA',
      next_signature: 'AAAA',
    }
    const rotated = altered(guardian, {
      info: () => Promise.resolve({ ...info, rotations: [rotation] }),
    })
    expect(await checkLedger(rotated, guardian.key, null)).toMatchObject({
      reason: 'invalid key rotation',
    })

    expect(await checkLedger(guardian, generateSigner().key, null)).toMatchObject({
      reason: 'invalid head signature',
    })
  })

  it('fails on a head that does not extend the last one seen', async () => {
    const { guardian } = await setup()
    const lastSeen = { ...(await guardian.head()), n: 1, root: hashOf('other') }
    expect(await checkLedger(guardian, guardian.key, lastSeen)).toMatchObject({
      reason: 'head does not extend the last one seen',
    })
  })

  it('checks the line a vote names', async () => {
    const { guardian, transition, vote } = await setup()
    const head = await guardian.head()
    const hash = bodyHash(transition)
    expect(await checkVoteLine(guardian, hash, vote, head)).toBe(true)
    const without: Vote = { type: 'raw', key: vote.key, signature: vote.signature }
    expect(await checkVoteLine(guardian, hash, without, head)).toBe(false)
    expect(await checkVoteLine(guardian, hash, { ...vote, line: head.n + 1 }, head)).toBe(false)
    expect(await checkVoteLine(guardian, hash, { ...vote, line_hash: hashOf('x') }, head)).toBe(
      false,
    )
    expect(await checkVoteLine(guardian, hashOf('other'), vote, head)).toBe(false)
    expect(await checkVoteLine(guardian, hash, vote, { ...head, root: hashOf('x') })).toBe(false)
  })
})
