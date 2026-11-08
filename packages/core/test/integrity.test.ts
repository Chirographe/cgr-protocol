import { describe, expect, it } from 'vitest'
import {
  Guardian,
  MemoryGuardianStore,
  checkLedger,
  memoryKeyring,
  predicates,
} from '../src/index.ts'
import { Network } from './support/network.ts'
import { mint, people, transfer } from './support/tokens.ts'

const { sig } = predicates
const { alice, bob } = people('alice', 'bob')

describe('ledger integrity and rotation', () => {
  it('locks a guardian whose ledger was rewritten', async () => {
    const net = new Network()
    const group = await net.group(['a'], 1)
    await mint(net, { group, owner: alice! })
    const { store } = net.node('a')
    store.tamper(1, { date: '2020-01-01T00:00:00.000Z' })
    const keyring = memoryKeyring()
    const reopened = await Guardian.open({ name: 'a', url: 'https://a.test', store, keyring })
    expect(reopened.locked).toBe(true)
    expect((await reopened.head()).locked).toBe(true)
  })

  it('rotates its key and keeps signing for groups that name the old one', async () => {
    const net = new Network()
    const group = await net.group(['a'], 1)
    const minted = await mint(net, { group, owner: alice! })
    const guardian = net.node('a').guardian
    const before = guardian.key
    await guardian.rotate()
    expect(guardian.key).not.toBe(before)
    const status = await checkLedger(guardian, before, null)
    expect(status.ok).toBe(true)
    const moved = await transfer(net, minted, [alice!], { lock: sig(bob!.key) })
    expect(moved.transition.guardians?.[0]?.rotations).toHaveLength(1)
  })

  it('reopens cleanly with its own keyring', async () => {
    const store = new MemoryGuardianStore()
    const keyring = memoryKeyring()
    const config = { name: 'a', url: 'https://a.test', store, keyring }
    const guardian = await Guardian.open(config)
    await guardian.rotate()
    const reopened = await Guardian.open(config)
    expect(reopened.locked).toBe(false)
    expect((await reopened.head()).n).toBe(1)
  })
})
