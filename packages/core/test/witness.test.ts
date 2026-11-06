import { describe, expect, it } from 'vitest'
import {
  Guardian,
  MemoryGuardianStore,
  Witness,
  checkLedger,
  checkTokenLine,
  composeProposal,
  commit,
  generateSigner,
  hashOf,
  headMessage,
  MemoryWitnessStore,
  memoryKeyring,
  signersForState,
  verifySignature,
  witnessMessage,
  type GuardianApi,
  type Head,
  type Keyring,
} from '../src/index.ts'
import { Network, groupOf, guardians, mint, newWallet } from './network.ts'

async function setup() {
  const net = new Network()
  const [x] = (await guardians(net, ['x'])) as [Guardian]
  const witness = new Witness(generateSigner(), net.directory, new MemoryWitnessStore(), net.clock)
  const key = await witness.follow(x.url)
  return { net, x, witness, key }
}

describe('witness', () => {
  it('countersigns heads', async () => {
    const { net, x, witness, key } = await setup()
    await mint(net, newWallet(), groupOf([x], 1))
    await witness.observe()
    const [seen] = await witness.state()
    expect(seen?.last_response).toBe(net.now.toISOString())
    const head = seen?.head
    expect(head?.n).toBe(1)
    const message = witnessMessage(key, head?.n as number, head?.root as string)
    expect(verifySignature(witness.key, head?.signature as string, message)).toBe(true)
    expect(seen?.frauds).toEqual([])
    expect(await witness.follow(x.url)).toBe(key)
  })

  it('keeps the last answer of a silent guardian', async () => {
    const { net, x, witness } = await setup()
    await witness.observe()
    const before = (await witness.state())[0]?.last_response
    net.advance(60)
    net.down.add(x.url)
    await witness.observe()
    expect((await witness.state())[0]?.last_response).toBe(before)
  })

  it('proves a fork from two signed heads', async () => {
    const { net, x, witness, key } = await setup()
    await mint(net, newWallet(), groupOf([x], 1))
    await witness.observe()
    const head = await x.head()
    expect(await witness.submit(key, head)).toEqual({ ok: true, fraud: null })

    // The guardian signs a second head at the same line.
    const root = hashOf('other ledger')
    const signer = (x as unknown as { keyring: Keyring }).keyring.current()
    const fork: Head = {
      ...head,
      root,
      signature: await signer.sign(headMessage(head.n, root)),
    }
    const { ok, fraud } = await witness.submit(key, fork)
    expect(ok).toBe(false)
    expect(fraud?.head_a.root).toBe(root)
    expect(fraud?.head_b?.root).toBe(head.root)
    expect((await witness.state())[0]?.frauds).toHaveLength(1)
    await witness.submit(key, fork)
    expect((await witness.state())[0]?.frauds).toHaveLength(1)
  })

  it('ignores unsigned heads and unknown guardians', async () => {
    const { x, witness, key } = await setup()
    const head = await x.head()
    expect(await witness.submit(key, { ...head, signature: 'AAAA' })).toEqual({
      ok: false,
      fraud: null,
    })
    expect(await witness.submit(generateSigner().key, head)).toEqual({ ok: true, fraud: null })
  })

  it('remembers heads submitted ahead of its rounds', async () => {
    const { net, x, witness, key } = await setup()
    await mint(net, newWallet(), groupOf([x], 1))
    const head = await x.head()
    expect((await witness.submit(key, head)).ok).toBe(true)
    await witness.observe()
    expect((await witness.state())[0]?.frauds).toEqual([])
  })

  it('flags lines that do not match the head', async () => {
    const { net, x } = await setup()
    await mint(net, newWallet(), groupOf([x], 1))
    const shown = (await x.lines(1, 1)).map((line) => ({ ...line, date: 'forged' }))
    const lying: GuardianApi = new Proxy(x, {
      get(target, property) {
        if (property === 'lines') return () => Promise.resolve(shown)
        const value = Reflect.get(target, property) as unknown
        return typeof value === 'function' ? value.bind(target) : value
      },
    })
    const directory = () => lying
    const other = new Witness(generateSigner(), directory, new MemoryWitnessStore(), net.clock)
    await other.follow(x.url)
    await other.observe()
    expect((await other.state())[0]?.frauds[0]?.reason).toBe('lines do not match the head')
  })

  it('flags a double spend it reads', async () => {
    const { net, x } = await setup()
    const shown = [
      {
        n: 1,
        type: 'transfer' as const,
        token_id: 'a',
        state_hash: 'b',
        spent: 'c',
        origin: null,
        date: 'd',
      },
      {
        n: 2,
        type: 'transfer' as const,
        token_id: 'a',
        state_hash: 'e',
        spent: 'c',
        origin: null,
        date: 'd',
      },
    ]
    const lying: GuardianApi = new Proxy(x, {
      get(target, property) {
        if (property === 'lines') return () => Promise.resolve(shown)
        const value = Reflect.get(target, property) as unknown
        return typeof value === 'function' ? value.bind(target) : value
      },
    })
    const other = new Witness(generateSigner(), () => lying, new MemoryWitnessStore(), net.clock)
    await other.follow(x.url)
    await other.observe()
    expect((await other.state())[0]?.frauds[0]?.reason).toBe('line 2 spends a state twice')
  })

  it('finishes its round when a guardian fails halfway', async () => {
    const net = new Network()
    const [x, y] = (await guardians(net, ['x', 'y'])) as [Guardian, Guardian]
    await mint(net, newWallet(), groupOf([x], 1))
    await mint(net, newWallet(), groupOf([y], 1))
    const failing: GuardianApi = new Proxy(x, {
      get(target, property) {
        if (property === 'lines') return () => Promise.reject(new Error('connection lost'))
        const value = Reflect.get(target, property) as unknown
        return typeof value === 'function' ? value.bind(target) : value
      },
    })
    const directory = (url: string) => (url === x.url ? failing : net.directory(url))
    const witness = new Witness(generateSigner(), directory, new MemoryWitnessStore(), net.clock)
    await witness.follow(x.url)
    await witness.follow(y.url)
    await witness.observe()
    const [first, second] = await witness.state()
    expect(first?.head).toBeNull()
    expect(second?.head?.n).toBe(1)
  })

  it('stops reading a guardian that never stops answering', async () => {
    const { net, x } = await setup()
    await mint(net, newWallet(), groupOf([x], 1))
    const [line] = await x.lines(1, 1)
    let calls = 0
    const endless: GuardianApi = new Proxy(x, {
      get(target, property) {
        if (property === 'lines') {
          return () => {
            calls++
            return Promise.resolve(Array.from({ length: 500 }, () => line))
          }
        }
        const value = Reflect.get(target, property) as unknown
        return typeof value === 'function' ? value.bind(target) : value
      },
    })
    const witness = new Witness(
      generateSigner(),
      () => endless,
      new MemoryWitnessStore(),
      net.clock,
    )
    await witness.follow(x.url)
    await witness.observe()
    expect(calls).toBe(2)
  })

  it('does not follow a guardian twice after its key rotated', async () => {
    const { x, witness, key } = await setup()
    await x.rotate()
    expect(await witness.follow(x.url)).toBe(key)
    expect(await witness.state()).toHaveLength(1)
  })

  it('picks up where it stopped after a restart', async () => {
    const net = new Network()
    const [x] = (await guardians(net, ['x'])) as [Guardian]
    await mint(net, newWallet(), groupOf([x], 1))
    const store = new MemoryWitnessStore()
    const first = new Witness(generateSigner(), net.directory, store, net.clock)
    const key = await first.follow(x.url)
    await first.observe()
    const head = await x.head()

    const restarted = new Witness(generateSigner(), net.directory, store, net.clock)
    const root = hashOf('other ledger')
    const signer = (x as unknown as { keyring: Keyring }).keyring.current()
    const signature = await signer.sign(headMessage(head.n, root))
    const { ok, fraud } = await restarted.submit(key, { ...head, root, signature })
    expect(ok).toBe(false)
    expect(fraud?.head_b?.root).toBe(head.root)
  })

  it('flags a rewritten ledger', async () => {
    const net = new Network()
    const store = new MemoryGuardianStore()
    const keyring = memoryKeyring()
    const url = 'https://x.test'
    const x = await Guardian.open({ name: 'x', url, store, keyring, clock: net.clock })
    const witness = new Witness(generateSigner(), () => x, new MemoryWitnessStore(), net.clock)
    await witness.follow(url)
    await witness.observe()
    await store.publishHead({ ...(await x.head()), signature: 'AAAA' })
    await witness.observe()
    expect((await witness.state())[0]?.frauds[0]?.reason).toBe('invalid head signature')
  })
})

describe('ledger check', () => {
  it('follows a growing ledger', async () => {
    const { net, x } = await setup()
    const alice = newWallet()
    const token = await mint(net, alice, groupOf([x], 1))
    const first = await checkLedger(x, x.key, null)
    expect(first.ok).toBe(true)
    const next = await composeProposal(token, {
      signers: signersForState(alice, token.state),
      expiresIn: 3600,
      now: net.now,
    })
    await commit(net.directory, next, token)
    const seen = first.ok ? first.head : null
    expect(await checkLedger(x, x.key, seen)).toMatchObject({ ok: true })
  })

  it('detects a head that does not extend the last one', async () => {
    const { net, x } = await setup()
    await mint(net, newWallet(), groupOf([x], 1))
    const head = await x.head()
    const status = await checkLedger(x, x.key, { ...head, root: hashOf('old') })
    expect(status).toEqual({ ok: false, reason: 'head does not extend the last one seen' })
  })

  it('detects a wrong key and a locked guardian', async () => {
    const { x } = await setup()
    const status = await checkLedger(x, generateSigner().key, null)
    expect(status).toEqual({ ok: false, reason: 'invalid head signature' })

    const locked = new Proxy(x, {
      get(target, property) {
        if (property === 'head') {
          return async () => ({ ...(await target.head()), locked: true })
        }
        const value = Reflect.get(target, property) as unknown
        return typeof value === 'function' ? value.bind(target) : value
      },
    })
    expect(await checkLedger(locked, x.key, null)).toEqual({
      ok: false,
      reason: 'guardian is locked',
    })
  })

  it('checks that a signed line is in the ledger', async () => {
    const { net, x } = await setup()
    const token = await mint(net, newWallet(), groupOf([x], 1))
    const [signature] = token.signatures.guardians ?? []
    if (!signature) throw new Error('no signature')
    const head = await x.head()
    expect(await checkTokenLine(x, token.state, signature, head)).toBe(true)
    const other = { ...token.state, date: '2020-01-01T00:00:00.000Z' }
    expect(await checkTokenLine(x, other, signature, head)).toBe(false)
  })
})
