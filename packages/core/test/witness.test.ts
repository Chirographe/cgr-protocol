import { describe, expect, it } from 'vitest'
import {
  Guardian,
  HttpWitness,
  MemoryGuardianStore,
  MemoryWitnessStore,
  Witness,
  generateSigner,
  hashOf,
  headMessage,
  memoryKeyring,
  verifySignature,
  witnessMessage,
  type Directory,
} from '../src/index.ts'
import { fakeFetch } from './support/fake-http.ts'
import { Network } from './support/network.ts'
import { mint, people, transfer } from './support/tokens.ts'

const { alice } = people('alice')
const URL_A = 'https://a.test'

async function watched(net: Network, directory: Directory = net.directory) {
  const store = new MemoryWitnessStore()
  const witness = new Witness(generateSigner(), directory, store, net.clock)
  return { witness, store }
}

async function setup() {
  const net = new Network()
  const group = await net.group(['a'], 1)
  await mint(net, { group, owner: alice! })
  const { witness, store } = await watched(net)
  const key = await witness.follow(URL_A)
  return { net, witness, store, key }
}

describe('witness', () => {
  it('follows a guardian once and countersigns its head', async () => {
    const { witness, key } = await setup()
    expect(await witness.follow(URL_A)).toBe(key)
    await witness.observe()
    const [state] = await witness.state()
    expect(state).toMatchObject({ key, url: URL_A, frauds: [], head: { guardian: key, n: 1 } })
    const { n, root, signature } = state!.head!
    expect(verifySignature(witness.key, signature, witnessMessage(key, n, root))).toBe(true)
    expect(state!.last_response).not.toBeNull()
  })

  it('proves a value spent twice', async () => {
    const net = new Network()
    const group = await net.group(['a'], 1)
    await transfer(net, await mint(net, { group, owner: alice! }), [alice!])
    const { guardian, store } = net.node('a')
    const [, spending] = await guardian.lines(1, 2)
    await guardian.rotate()
    store.tamper(3, { spent: spending!.spent })
    const { witness } = await watched(net)
    const key = await witness.follow(URL_A)
    await witness.observe()
    const [state] = await witness.state()
    expect(state!.frauds).toMatchObject([{ guardian: key, reason: 'line 3 spends a value twice' }])
  })

  it('proves lines that do not match the head', async () => {
    const { net, witness } = await setup()
    net.node('a').store.tamper(1, { date: '2020-01-01T00:00:00.000Z' })
    await witness.observe()
    const [state] = await witness.state()
    expect(state!.frauds).toMatchObject([{ reason: 'lines do not match the head' }])
  })

  it('reports a guardian that fails the ledger check, and keeps going', async () => {
    const { net, witness } = await setup()
    await net.add('b')
    await witness.follow('https://b.test')
    net.down.add('https://b.test')
    const store = net.node('a').store
    store.tamper(1, { date: '2020-01-01T00:00:00.000Z' })
    const locked = await Guardian.open({ name: 'a', url: URL_A, store, keyring: memoryKeyring() })
    net.nodes.set(URL_A, { guardian: locked, store })
    await witness.observe()
    const states = await witness.state()
    expect(states[0]!.frauds).toMatchObject([{ reason: 'guardian is locked' }])
    expect(states[1]!.last_response).toBeNull()
  })

  it('compares the heads clients show with the ones it saw', async () => {
    const net = new Network()
    const keyring = memoryKeyring()
    const store = new MemoryGuardianStore()
    const guardian = await Guardian.open({
      name: 'g',
      url: URL_A,
      store,
      keyring,
      clock: net.clock,
    })
    const { witness } = await watched(net, () => guardian)
    await witness.follow(URL_A)
    await witness.observe()
    const head = await guardian.head()

    expect(await witness.submit(generateSigner().key, head)).toEqual({ ok: true, fraud: null })
    expect(await witness.submit(guardian.key, head)).toEqual({ ok: true, fraud: null })
    const root = hashOf('other')
    const forged = { ...head, root, signature: 'AAAA' }
    expect(await witness.submit(guardian.key, forged)).toEqual({ ok: false, fraud: null })
    const fork = {
      ...head,
      root,
      signature: await keyring.current().sign(headMessage(head.n, root)),
    }
    const answer = await witness.submit(guardian.key, fork)
    expect(answer).toMatchObject({ ok: false, fraud: { reason: `two ledgers at line ${head.n}` } })
  })

  it('is reached over HTTP', async () => {
    const { witness, key } = await setup()
    await witness.observe()
    const hosts = new Map([['https://w.test', { witness, witnessName: 'w' }]])
    const client = new HttpWitness('https://w.test', { fetch: fakeFetch(hosts) })
    expect(await client.info()).toEqual({ key: witness.key, name: 'w' })
    const [state] = await client.guardians()
    expect(state?.key).toBe(key)
    expect(await client.submitHead(key, state!.head as never)).toMatchObject({ ok: false })
  })
})
