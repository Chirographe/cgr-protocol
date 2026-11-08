import { createServer } from 'node:net'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  HttpGuardian,
  HttpWitness,
  checkLedger,
  commit,
  generateSigner,
  hashOf,
  httpDirectory,
  predicates,
  schemeOf,
  type GuardianStorage,
} from '@chirographe/core'
import { heldAt, move, newToken, people } from '../../core/test/support/tokens.ts'
import {
  rotateGuardianKey,
  startGuardian,
  startWitness,
  type GuardianServerConfig,
  type WitnessServerConfig,
} from '../src/index.ts'
import { LOCALHOST, memoryGuardianStorage, memoryWitnessStorage, track } from './support.ts'

const { sig } = predicates
const { alice, bob } = people('alice', 'bob')
const WAIT = { timeout: 5000 }

const freePort = () =>
  new Promise<number>((resolve) => {
    const probe = createServer().listen(0, LOCALHOST, () => {
      const { port } = probe.address() as { port: number }
      probe.close(() => resolve(port))
    })
  })

const common = (port: number) => ({
  password: 'secret',
  host: LOCALHOST,
  port,
  corsOrigins: [],
  trustProxy: false,
})

describe('a running deployment', { timeout: 60_000 }, () => {
  let config: GuardianServerConfig
  let storage: GuardianStorage

  beforeEach(async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined)
    const port = await freePort()
    storage = memoryGuardianStorage()
    config = {
      ...common(port),
      name: 'x',
      url: `http://${LOCALHOST}:${port}`,
      policy: { issuers: null, origins: null, maxValiditySeconds: 3600 },
      requestsPerMinute: 60,
    }
  })

  const start = async () => {
    const { app, guardian } = await startGuardian(config, storage)
    return {
      app,
      guardian,
      group: { members: [{ key: guardian.key, url: guardian.url }], threshold: 1 },
    }
  }

  it('keeps its key, ledger and mailboxes across a restart', async () => {
    const first = await start()
    const directory = httpDirectory()
    const minted = heldAt(
      await commit(directory, await newToken({ group: first.group, owner: alice! }), []),
    )
    const client = new HttpGuardian(config.url)
    const holder = generateSigner()
    await client.deposit(holder.key, { ephemeral: holder.key, ciphertext: 'AAAA' })
    const head = await client.head()
    await first.app.close()

    const second = await start()
    track(second.app)
    expect(second.guardian.key).toBe(first.guardian.key)
    expect(second.guardian.locked).toBe(false)
    expect(await client.head()).toEqual(head)
    const session = await client.authenticate(holder)
    expect(await client.messages(holder.key, session)).toHaveLength(1)
    const sold = await move(minted, [alice!], { lock: sig(bob!.key) })
    await expect(commit(directory, sold, [minted.transition])).resolves.toBeDefined()
  })

  it('rotates its key offline, and stays verifiable', async () => {
    const first = await start()
    const client = new HttpGuardian(config.url)
    const before = await client.head()
    await first.app.close()

    await rotateGuardianKey(config, storage)

    const second = await start()
    track(second.app)
    expect(second.guardian.key).not.toBe(first.guardian.key)
    const status = await checkLedger(client, first.guardian.key, before)
    expect(status).toMatchObject({ ok: true, key: second.guardian.key })
  })

  it('refuses a wrong password', async () => {
    const first = await start()
    await first.app.close()
    await expect(startGuardian({ ...config, password: 'wrong' }, storage)).rejects.toThrow(
      'wrong password',
    )
  })

  it('registers the membership schemes it is given', async () => {
    const verify = vi.fn(() => Promise.resolve(false))
    const scheme = { id: 'deployment-test/1', verify }
    const { app } = await startGuardian(config, storage, { schemes: [scheme] })
    track(app)
    expect(schemeOf(scheme.id)).toBe(scheme)
  })

  it('is watched by a witness, over HTTP, across restarts', async () => {
    const guardian = await start()
    track(guardian.app)
    await commit(httpDirectory(), await newToken({ group: guardian.group, owner: alice! }), [])

    const port = await freePort()
    const witnessConfig: WitnessServerConfig = {
      ...common(port),
      name: 'w',
      guardians: [config.url],
      intervalSeconds: 3600,
    }
    const witnessStorage = memoryWitnessStorage()
    const first = await startWitness(witnessConfig, witnessStorage)
    const client = new HttpWitness(`http://${LOCALHOST}:${port}`)
    await vi.waitFor(async () => expect((await client.guardians())[0]?.head?.n).toBe(1), WAIT)
    expect(await client.info()).toEqual({ key: first.witness.key, name: 'w' })

    const head = await new HttpGuardian(config.url).head()
    const key = guardian.guardian.key
    expect(await client.submitHead(key, head)).toEqual({ ok: true, fraud: null })
    const forged = { ...head, root: hashOf('other'), signature: 'AAAA' }
    expect(await client.submitHead(key, forged)).toMatchObject({ ok: false })
    await first.app.close()

    const second = await startWitness(witnessConfig, witnessStorage)
    track(second.app)
    expect(second.witness.key).toBe(first.witness.key)
    expect((await client.guardians())[0]?.head?.n).toBe(1)
  })
})
