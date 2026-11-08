import { describe, expect, it } from 'vitest'
import {
  announceTakeover,
  canSign,
  commit,
  inspect,
  noticesOf,
  predicates,
  scanOwners,
  type GuardianApi,
  type OwnerEntry,
  type PartyContext,
} from '../src/index.ts'
import { Network } from './support/network.ts'
import { mint, move, people, transfer } from './support/tokens.ts'

const { sig } = predicates
const { alice, bob } = people('alice', 'bob')
const DELAY = 60
const PAGE = 500

const contextOf = (net: Network): PartyContext => ({
  directory: net.directory,
  trustOf: () => 'trusted',
  lastSeen: new Map(),
  expects: () => true,
})

async function setup() {
  const net = new Network()
  const group = await net.group(['a'], 1)
  const rescue = await net.group(['r', 's', 't', 'u'], 3)
  const minted = await mint(net, {
    group,
    owner: alice!,
    recovery: { group: rescue, delay_seconds: DELAY },
  })
  const takeover = await move(minted, [alice!], { group: rescue }, rescue)
  return { net, rescue, minted, takeover }
}

describe('client recovery helpers', () => {
  it('reads notices member by member, skipping unreachable ones', async () => {
    const { net, rescue, minted, takeover } = await setup()
    await announceTakeover(net.directory, takeover, [minted.transition])
    net.down.add('https://u.test')
    const reports = await noticesOf(net.directory, rescue)
    expect(reports).toHaveLength(3)
    expect(reports.every((notices) => notices[0]?.status === 'open')).toBe(true)
  })

  it('blocks a party while a notice is open, and after a completed takeover', async () => {
    const { net, minted, takeover } = await setup()
    const proposal = await move(minted, [alice!], { lock: sig(bob!.key) })
    const submission = { transition: proposal, previous: [minted.transition] }
    const before = await inspect(submission, contextOf(net))
    expect(before.find((c) => c.name === 'no-notice')?.ok).toBe(true)

    await announceTakeover(net.directory, takeover, [minted.transition])
    const open = await inspect(submission, contextOf(net))
    expect(open.find((c) => c.name === 'no-notice')?.ok).toBe(false)
    expect(canSign(open)).toBe(false)

    net.advance(DELAY)
    await commit(net.directory, takeover, [minted.transition])
    const completed = await inspect(submission, contextOf(net))
    expect(completed.find((c) => c.name === 'no-notice')?.ok).toBe(false)
  })

  it('flags previous transitions that are not final or not given', async () => {
    const { net, minted } = await setup()
    const proposal = await move(minted, [alice!], { lock: sig(bob!.key) })
    const missing = await inspect({ transition: proposal, previous: [] }, contextOf(net))
    expect(missing).toEqual([{ name: 'previous-final', ok: false, blocking: true }])
    const blocked = { ...contextOf(net), trustOf: () => 'blocked' as const }
    const checks = await inspect({ transition: proposal, previous: [minted.transition] }, blocked)
    expect(checks.find((c) => c.name === 'guardians-not-blocked')?.ok).toBe(false)
    const moved = await transfer(net, minted, [alice!])
    const expired = { ...contextOf(net), now: new Date('2100-01-01T00:00:00.000Z') }
    expect(
      (await inspect({ transition: proposal, previous: [moved.transition] }, expired))[0]?.ok,
    ).toBe(false)
  })
})

describe('owner scan', () => {
  it('pages through every owner and keeps the matches', async () => {
    const all: OwnerEntry[] = Array.from({ length: PAGE + 2 }, (_, i) => ({
      n: i + 1,
      keys: [i % 2 === 0 ? 'p256:even' : 'p256:odd'],
    }))
    const pages: number[] = []
    const guardian = {
      owners: (from: number, limit: number) => {
        pages.push(from)
        return Promise.resolve(all.filter((e) => e.n >= from).slice(0, limit))
      },
    } as GuardianApi
    const found = await scanOwners(guardian, (keys) => keys.includes('p256:even'))
    expect(found).toHaveLength((PAGE + 2) / 2)
    expect(pages).toEqual([1, PAGE + 1])
  })

  it('stops on an empty guardian', async () => {
    const guardian = { owners: () => Promise.resolve([]) } as unknown as GuardianApi
    expect(await scanOwners(guardian, () => true)).toEqual([])
  })
})
