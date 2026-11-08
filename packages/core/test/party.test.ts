import { describe, expect, it } from 'vitest'
import { canSign, inspect, predicates, type PartyContext } from '../src/index.ts'
import { Network } from './support/network.ts'
import { mint, move, people, transfer } from './support/tokens.ts'

const { sig } = predicates
const { alice, bob } = people('alice', 'bob')

const contextOf = (net: Network, expects = true): PartyContext => ({
  directory: net.directory,
  trustOf: () => 'trusted',
  lastSeen: new Map(),
  expects: () => expects,
  now: net.now,
})

describe('party checks', () => {
  it('passes for an unspent, final, expected input', async () => {
    const net = new Network()
    const group = await net.group(['a', 'b', 'c', 'd'], 3)
    const minted = await mint(net, { group, owner: alice! })
    const proposal = await move(minted, [alice!], { lock: sig(bob!.key) })
    const checks = await inspect(
      { transition: proposal, previous: [minted.transition] },
      contextOf(net),
    )
    expect(checks.filter((c) => !c.ok)).toEqual([])
    expect(canSign(checks)).toBe(true)
  })

  it('blocks a spent input and an unexpected profile', async () => {
    const net = new Network()
    const group = await net.group(['a'], 1)
    const minted = await mint(net, { group, owner: alice! })
    const proposal = await move(minted, [alice!], { lock: sig(bob!.key) })
    await transfer(net, minted, [alice!])
    const checks = await inspect(
      { transition: proposal, previous: [minted.transition] },
      contextOf(net, false),
    )
    const failed = checks.filter((c) => !c.ok).map((c) => c.name)
    expect(failed).toEqual(['profile', 'unspent'])
    expect(canSign(checks)).toBe(false)
  })

  it('warns about guardians it does not trust', async () => {
    const net = new Network()
    const group = await net.group(['a'], 1)
    const minted = await mint(net, { group, owner: alice! })
    const proposal = await move(minted, [alice!], { lock: sig(bob!.key) })
    const context = { ...contextOf(net), trustOf: () => 'unknown' as const }
    const checks = await inspect({ transition: proposal, previous: [minted.transition] }, context)
    expect(checks.find((c) => c.name === 'guardians-trusted')?.ok).toBe(false)
    expect(canSign(checks)).toBe(true)
  })
})
