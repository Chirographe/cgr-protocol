import { mkdtempSync, rmSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { FastifyInstance } from 'fastify'
import {
  Guardian,
  HttpGuardian,
  HttpWitness,
  Mailboxes,
  MemoryGuardianStore,
  MemoryMailboxStore,
  ProtocolError,
  checkLedger,
  commit,
  composeProposal,
  composeToken,
  createToken,
  deriveOwner,
  finalizeRecovery,
  generateSigner,
  generateWallet,
  hashOf,
  httpDirectory,
  memoryKeyring,
  p256,
  requestRecovery,
  sealMessage,
  signersForState,
  walletAddress,
  type Group,
  type Recovery,
  type Token,
  type Wallet,
} from '@chirographe/core'
import { openGuardianStorage, openWitnessStorage } from '@chirographe/storage-sqlite'
import {
  closeOnSignal,
  createGuardianServer,
  rateLimit,
  readGuardianConfig,
  readWitnessConfig,
  rotateGuardianKey,
  startGuardian,
  startWitness,
  type GuardianServerConfig,
  type WitnessServerConfig,
} from '../src/index.ts'

const apps: FastifyInstance[] = []
const folders: string[] = []

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()))
  for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true })
})

function newFolder(): string {
  const folder = mkdtempSync(join(tmpdir(), 'chirographe-'))
  folders.push(folder)
  return folder
}

const addresses = new Map<string, string>()

/** Guardians know each other by public URL. This maps those URLs to local sockets. */
const directory = httpDirectory({
  fetch: (url, init) => {
    const { origin, pathname, search } = new URL(url)
    return fetch(`${addresses.get(origin)}${pathname}${search}`, init)
  },
})

interface ServeOptions {
  name?: string
  clock?: () => Date
  corsOrigins?: string[]
  requestsPerMinute?: number
}

async function serve({ name = 'x', clock, ...options }: ServeOptions = {}) {
  const url = `https://${name}.test`
  const guardian = await Guardian.open({
    name,
    url,
    store: new MemoryGuardianStore(),
    keyring: memoryKeyring(),
    ...(clock ? { clock } : {}),
  })
  const mailboxes = new Mailboxes(new MemoryMailboxStore())
  const app = await createGuardianServer({ guardian, mailboxes, ...options })
  apps.push(app)
  const address = await app.listen({ host: '127.0.0.1', port: 0 })
  addresses.set(url, address)
  return {
    app,
    guardian,
    address,
    directory,
    client: new HttpGuardian(address),
    group: { members: [{ key: guardian.key, url }], threshold: 1 },
  }
}

const newWallet = (): Wallet => generateWallet(p256, 1, 1)

async function compose(wallet: Wallet, group: Group, recovery?: Recovery): Promise<Token> {
  const address = walletAddress(wallet, 'https://relay.test', false)
  const owner = { keys: address.keys, threshold: address.threshold }
  return composeToken({
    owner,
    signers: signersForState(wallet, { owner } as Token['state']),
    subject: 'Parcel 42',
    guardian: group,
    recovery: recovery ?? null,
  })
}

const scanMessage = (scan: string) => ({ ephemeral: scan, ciphertext: 'AAAA' })

describe('guardian routes', () => {
  it('serves the ledger and verifiable proofs', async () => {
    const { client, group, guardian, directory } = await serve()
    const before = await client.head()
    expect(before.n).toBe(0)

    const token = await createToken(directory, await compose(newWallet(), group))
    expect((await client.info()).key).toBe(guardian.key)
    expect(await client.lines(1, 500)).toHaveLength(1)
    expect(await client.tokenHead(token.state.token_id)).toMatchObject({ here: true, sequence: 0 })

    const status = await checkLedger(client, guardian.key, before)
    expect(status.ok).toBe(true)
    expect(await client.inclusionProof(1, 1)).toEqual([])
  })

  it('reports refusals with their code, status and details', async () => {
    const { address, client, group, directory } = await serve()
    const wallet = newWallet()
    const token = await createToken(directory, await compose(wallet, group))

    const unknown = client.tokenHead(hashOf('unknown'))
    await expect(unknown).rejects.toBeInstanceOf(ProtocolError)
    await expect(unknown).rejects.toMatchObject({ code: 'UNKNOWN_STATE', status: 404 })

    const tampered = { ...token, rules: { ...token.rules, subject: 'Forged' } }
    await expect(client.validate(tampered)).rejects.toMatchObject({ code: 'RULES_TAMPERED' })

    const response = await fetch(`${address}/tokens/${encodeURIComponent(hashOf('x'))}/head`)
    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({ error: 'UNKNOWN_STATE', message: 'unknown token' })
  })

  it('refuses malformed requests', async () => {
    const { address } = await serve()
    const post = (path: string, body: string) =>
      fetch(`${address}${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body,
      })
    const broken = await post('/tokens/validate', '{')
    expect(broken.status).toBe(400)
    expect(await broken.json()).toMatchObject({ error: 'INVALID_FORMAT' })

    expect((await post('/tokens/validate', '{"format":"other"}')).status).toBe(400)
    expect((await post('/auth/challenge', '{"key":"nope"}')).status).toBe(400)
    expect((await fetch(`${address}/tokens/nope/head`)).status).toBe(400)
    expect((await fetch(`${address}/ledger/lines?limit=501`)).status).toBe(400)
    expect((await fetch(`${address}/ledger/proof?line=2&size=1`)).status).toBe(400)
    expect((await fetch(`${address}/ledger/consistency?from=2&to=1`)).status).toBe(400)
    expect((await fetch(`${address}/ledger/proof?line=1&size=9`)).status).toBe(404)

    const missing = await fetch(`${address}/nowhere`)
    expect(missing.status).toBe(404)
    expect(await missing.json()).toMatchObject({ error: 'UNKNOWN_STATE' })
  })

  it('never leaks an internal error', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const { app, address, guardian } = await serve()
    vi.spyOn(guardian, 'head').mockRejectedValue(new Error('disk path /secret'))
    const response = await fetch(`${address}/ledger/head`)
    expect(response.status).toBe(500)
    expect(await response.json()).toEqual({ error: 'INTERNAL', message: 'internal error' })
    expect(error).toHaveBeenCalled()
    error.mockRestore()
    expect(app.server.listening).toBe(true)
  })

  it('answers browsers from allowed origins only', async () => {
    const { address } = await serve({ corsOrigins: ['https://wallet.test'] })
    const allowed = await fetch(`${address}/ledger/head`, {
      headers: { origin: 'https://wallet.test' },
    })
    expect(allowed.headers.get('access-control-allow-origin')).toBe('https://wallet.test')
    const other = await fetch(`${address}/ledger/head`, {
      headers: { origin: 'https://evil.test' },
    })
    expect(other.headers.get('access-control-allow-origin')).toBeNull()
  })
})

describe('operations over HTTP', () => {
  it('moves a token to another group', async () => {
    const from = await serve({ name: 'from' })
    const to = await serve({ name: 'to' })
    const wallet = newWallet()
    const token = await createToken(directory, await compose(wallet, from.group))
    const proposal = await composeProposal(token, {
      signers: signersForState(wallet, token.state),
      guardian: to.group,
      expiresIn: 3600,
    })
    const final = await commit(directory, proposal, token)
    expect(final.state.guardian).toEqual(to.group)
    expect(await to.client.tokenHead(token.state.token_id)).toMatchObject({ here: true })
    expect(await from.client.tokenHead(token.state.token_id)).toMatchObject({ here: false })
  })

  it('takes over a token after its delay', async () => {
    let now = new Date('2026-11-06T12:00:00.000Z')
    const clock = () => now
    const main = await serve({ name: 'main', clock })
    const rescue = await serve({ name: 'rescue', clock })
    const wallet = newWallet()
    const recovery = { group: rescue.group, delay_seconds: 60 }
    const token = await createToken(directory, await compose(wallet, main.group, recovery))
    const signers = signersForState(wallet, token.state)

    const { proposal } = await requestRecovery(directory, token, signers)
    expect(await rescue.client.announcements()).toMatchObject([{ status: 'announced' }])
    const early = finalizeRecovery(directory, proposal, token)
    await expect(early).rejects.toMatchObject({ code: 'POLICY_REFUSED', status: 403 })

    now = new Date(now.getTime() + 61_000)
    const final = await finalizeRecovery(directory, proposal, token)
    expect(final.state.guardian).toEqual(rescue.group)
  })

  it('stops a recovery when the holder opposes it', async () => {
    const main = await serve({ name: 'main' })
    const rescue = await serve({ name: 'rescue' })
    const wallet = newWallet()
    const recovery = { group: rescue.group, delay_seconds: 60 }
    const token = await createToken(directory, await compose(wallet, main.group, recovery))
    const signers = signersForState(wallet, token.state)

    const next = await composeProposal(token, { signers, expiresIn: 3600 })
    const later = await commit(directory, next, token)
    await requestRecovery(directory, token, signers)

    await expect(rescue.client.oppose({ token: later, previous: token })).resolves.toMatchObject({
      line: expect.any(Number) as number,
    })
    expect(await rescue.client.announcements()).toMatchObject([{ status: 'opposed' }])
  })
})

describe('shutdown', () => {
  it('closes the server on the signals of a process manager', async () => {
    const { app } = await serve()
    const handlers = new Map<string, () => void>()
    const once = vi.spyOn(process, 'once').mockImplementation(((
      signal: string,
      handler: () => void,
    ) => {
      handlers.set(signal, handler)
      return process
    }) as typeof process.once)
    closeOnSignal(app)
    once.mockRestore()
    expect([...handlers.keys()]).toEqual(['SIGINT', 'SIGTERM'])
    handlers.get('SIGTERM')?.()
    await vi.waitFor(() => expect(app.server.listening).toBe(false))
  })
})

describe('relay and sessions over HTTP', () => {
  it('delivers a message to the holder of the scan key only', async () => {
    const { client } = await serve()
    const holder = generateSigner()
    const scan = holder.key
    const { id } = await client.deposit(scan, scanMessage(scan))

    await expect(client.messages(scan, 'forged')).rejects.toMatchObject({ code: 'UNAUTHENTICATED' })
    const stranger = await client.authenticate(generateSigner())
    await expect(client.messages(scan, stranger)).rejects.toMatchObject({ status: 401 })

    const session = await client.authenticate(holder)
    const messages = await client.messages(scan, session)
    expect(messages).toMatchObject([{ id, content: scanMessage(scan) }])

    await expect(client.deleteMessage(scan, id, stranger)).rejects.toMatchObject({ status: 401 })
    await client.deleteMessage(scan, id, session)
    expect(await client.messages(scan, session)).toEqual([])
  })

  it('carries a sealed envelope', async () => {
    const { client, group, directory } = await serve()
    const alice = newWallet()
    const bob = newWallet()
    const token = await createToken(directory, await compose(alice, group))
    const address = walletAddress(bob, 'https://relay.test', true)
    const proposal = await composeProposal(token, {
      signers: signersForState(alice, token.state),
      recipient: deriveOwner(address),
      expiresIn: 3600,
    })
    const from = walletAddress(alice, 'https://relay.test')
    const sealed = sealMessage(address.scan, { from, proposal, previous: token })
    await expect(client.deposit(address.scan, sealed)).resolves.toMatchObject({ id: 1 })
  })

  it('refuses clear text and oversized messages', async () => {
    const { address, client } = await serve()
    const scan = generateSigner().key
    const url = `${address}/mailbox/${encodeURIComponent(scan)}`
    const post = (body: unknown) =>
      fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      })
    expect((await post({ clear: 'text' })).status).toBe(400)
    const oversized = await post({ ephemeral: scan, ciphertext: 'A'.repeat(300 * 1024) })
    expect(oversized.status).toBe(400)
    await expect(client.deposit(scan, scanMessage(scan))).resolves.toBeDefined()
  })

  it('limits deposits and challenges per client', async () => {
    const { client } = await serve({ requestsPerMinute: 2 })
    const scan = generateSigner().key
    await client.deposit(scan, scanMessage(scan))
    await client.deposit(scan, scanMessage(scan))
    const refused = client.deposit(scan, scanMessage(scan))
    await expect(refused).rejects.toMatchObject({ code: 'TOO_MANY_REQUESTS', status: 429 })
    await expect(client.authenticate(generateSigner())).rejects.toMatchObject({ status: 429 })
  })

  it('shows tokens to their owner only', async () => {
    const { client, group, directory } = await serve()
    const wallet = newWallet()
    const token = await createToken(directory, await compose(wallet, group))
    const key = token.state.owner.keys[0] as string
    const signer = signersForState(wallet, token.state)[0]
    if (!signer) throw new Error('no signer')

    await expect(client.tokensOf(key, 'forged')).rejects.toMatchObject({ status: 401 })
    const session = await client.authenticate(signer)
    const tokens = await client.tokensOf(key, session)
    expect(tokens.map((t) => hashOf(t.state))).toEqual([hashOf(token.state)])
    expect(await client.owners(1, 500)).toHaveLength(1)
  })
})

describe('http client', () => {
  const answer = (body: string, status = 200) =>
    new HttpGuardian('https://x.test/', {
      fetch: () => Promise.resolve(new Response(body, { status })),
    })

  it('treats an unknown failure as a plain error', async () => {
    const failing = answer('<html>bad gateway</html>', 502).head()
    await expect(failing).rejects.toThrow('HTTP 502')
    await expect(failing).rejects.not.toBeInstanceOf(ProtocolError)
    const invented = answer('{"error":"NOT_A_CODE","message":"x"}', 400).head()
    await expect(invented).rejects.not.toBeInstanceOf(ProtocolError)
  })

  it('does not trust the shape of an answer', async () => {
    await expect(answer('{"n":"1"}').head()).rejects.toThrow('invalid answer')
    await expect(answer('{"lines":[{"n":1}]}').lines(1, 1)).rejects.toThrow('invalid answer')
    await expect(answer('not json').info()).rejects.toThrow('invalid answer')
  })

  it('gives up on a guardian that hangs', async () => {
    const hanging = new HttpGuardian('https://x.test', {
      timeoutSeconds: 0.01,
      fetch: (_url, init) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => reject(new Error('timed out')))
        }),
    })
    await expect(hanging.head()).rejects.toThrow('timed out')
  })

  it('uses whatever fetch it is given, and normalizes the base URL', async () => {
    const urls: string[] = []
    const client = new HttpGuardian('https://x.test///', {
      fetch: (url) => {
        urls.push(url)
        return Promise.resolve(new Response('{"path":[]}'))
      },
    })
    await client.consistencyProof(0, 3)
    expect(urls).toEqual(['https://x.test/ledger/consistency?from=0&to=3'])
  })
})

describe('rate limit', () => {
  it('starts over each minute and counts clients apart', () => {
    let now = 0
    const limit = rateLimit(1, () => now)
    limit('a')
    limit('b')
    expect(() => limit('a')).toThrow('too many requests')
    now = 60_000
    expect(() => limit('a')).not.toThrow()
  })
})

describe('configuration', () => {
  const env = {
    GUARDIAN_NAME: 'x',
    GUARDIAN_URL: 'https://x.test',
    GUARDIAN_PASSWORD: 'secret',
  }

  it('reads a guardian configuration', () => {
    const config = readGuardianConfig({
      ...env,
      PORT: '5000',
      CORS_ORIGINS: 'https://a.test, https://b.test',
      GUARDIAN_CREATORS: 'p256:AAAA',
      TRUST_PROXY: 'true',
    })
    expect(config).toMatchObject({
      host: '127.0.0.1',
      port: 5000,
      corsOrigins: ['https://a.test', 'https://b.test'],
      trustProxy: true,
      policy: { creators: ['p256:AAAA'], origins: null },
    })
  })

  it('refuses a missing password or an invalid number', () => {
    expect(() => readGuardianConfig({ ...env, GUARDIAN_PASSWORD: '' })).toThrow('GUARDIAN_PASSWORD')
    expect(() => readGuardianConfig({ ...env, PORT: 'many' })).toThrow('invalid PORT')
  })

  it('reads a witness configuration', () => {
    const config = readWitnessConfig({
      WITNESS_NAME: 'w',
      WITNESS_PASSWORD: 'secret',
      WITNESS_GUARDIANS: 'https://x.test,https://y.test',
    })
    expect(config).toMatchObject({
      port: 4100,
      guardians: ['https://x.test', 'https://y.test'],
      intervalSeconds: 30,
    })
  })
})

const freePort = () =>
  new Promise<number>((resolve) => {
    const probe = createServer().listen(0, '127.0.0.1', () => {
      const { port } = probe.address() as { port: number }
      probe.close(() => resolve(port))
    })
  })

describe('a running deployment', { timeout: 60_000 }, () => {
  let config: GuardianServerConfig
  let folder: string

  beforeEach(async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined)
    const port = await freePort()
    folder = newFolder()
    config = {
      name: 'x',
      url: `http://127.0.0.1:${port}`,
      password: 'secret',
      host: '127.0.0.1',
      port,
      corsOrigins: [],
      trustProxy: false,
      policy: { creators: null, origins: null, maxProposalSeconds: 3600 },
      requestsPerMinute: 60,
    }
  })

  const start = async () => {
    const { app, guardian } = await startGuardian(config, openGuardianStorage(folder))
    return { app, guardian, member: { key: guardian.key, url: guardian.url } }
  }

  it('keeps its key, ledger and mailboxes across a restart', async () => {
    const first = await start()
    const directory = httpDirectory()
    const group = { members: [first.member], threshold: 1 }
    const wallet = newWallet()
    const token = await createToken(directory, await compose(wallet, group))
    const client = new HttpGuardian(config.url)
    const holder = generateSigner()
    await client.deposit(holder.key, scanMessage(holder.key))
    const head = await client.head()
    await first.app.close()

    const second = await start()
    apps.push(second.app)
    expect(second.guardian.key).toBe(first.guardian.key)
    expect(second.guardian.locked).toBe(false)
    expect(await client.head()).toEqual(head)
    const session = await client.authenticate(holder)
    expect(await client.messages(holder.key, session)).toHaveLength(1)

    const next = await composeProposal(token, {
      signers: signersForState(wallet, token.state),
      expiresIn: 3600,
    })
    await expect(commit(directory, next, token)).resolves.toBeDefined()
  })

  it('rotates its key offline, and stays verifiable', async () => {
    const first = await start()
    const client = new HttpGuardian(config.url)
    const before = await client.head()
    await first.app.close()

    await rotateGuardianKey(config, openGuardianStorage(folder))

    const second = await start()
    apps.push(second.app)
    expect(second.guardian.key).not.toBe(first.guardian.key)
    const status = await checkLedger(client, first.guardian.key, before)
    expect(status).toMatchObject({ ok: true, key: second.guardian.key })
  })

  it('refuses a wrong password', async () => {
    const first = await start()
    await first.app.close()
    const storage = openGuardianStorage(folder)
    await expect(startGuardian({ ...config, password: 'wrong' }, storage)).rejects.toThrow(
      'wrong password',
    )
    await storage.close()
  })

  it('is watched by a witness, over HTTP, across restarts', async () => {
    const guardian = await start()
    apps.push(guardian.app)
    const group = { members: [guardian.member], threshold: 1 }
    await createToken(httpDirectory(), await compose(newWallet(), group))

    const witnessFolder = newFolder()
    const port = await freePort()
    const witnessConfig: WitnessServerConfig = {
      name: 'w',
      password: 'secret',
      host: '127.0.0.1',
      port,
      corsOrigins: [],
      trustProxy: false,
      guardians: [config.url],
      intervalSeconds: 3600,
    }
    const first = await startWitness(witnessConfig, openWitnessStorage(witnessFolder))
    const client = new HttpWitness(`http://127.0.0.1:${port}`)
    await vi.waitFor(async () => expect((await client.guardians())[0]?.head?.n).toBe(1), {
      timeout: 5000,
    })
    expect(await client.info()).toEqual({ key: first.witness.key, name: 'w' })

    const head = await new HttpGuardian(config.url).head()
    expect(await client.submitHead(guardian.guardian.key, head)).toEqual({ ok: true, fraud: null })
    const forged = { ...head, root: hashOf('other'), signature: 'AAAA' }
    expect(await client.submitHead(guardian.guardian.key, forged)).toMatchObject({ ok: false })
    await first.app.close()

    const second = await startWitness(witnessConfig, openWitnessStorage(witnessFolder))
    apps.push(second.app)
    expect(second.witness.key).toBe(first.witness.key)
    expect((await client.guardians())[0]?.head?.n).toBe(1)
  })
})
