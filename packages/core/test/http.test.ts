import { describe, expect, it } from 'vitest'
import {
  HttpGuardian,
  HttpWitness,
  ZERO_HASH,
  generateSigner,
  hashOf,
  httpDirectory,
  type Fetch,
  type Head,
  type Token,
} from '../src/index.ts'
import { Network, groupOf, guardians, mint, newWallet } from './network.ts'

const hash = hashOf('state')
const key = generateSigner().key
const DATE = '2026-11-06T12:00:00.000Z'
const head: Head = { n: 1, root: hash, date: DATE, signature: 'AAAA' }

interface Sent {
  method: string
  path: string
  body: unknown
  authorization: string | null
}

/** Records what the client sends, and answers with `body`. */
function stub(body: unknown) {
  const sent: Sent[] = []
  const fetch: Fetch = (url, init) => {
    const { pathname, search } = new URL(url)
    sent.push({
      method: init.method ?? 'GET',
      path: decodeURIComponent(`${pathname}${search}`),
      body: init.body ? (JSON.parse(init.body as string) as unknown) : null,
      authorization: new Headers(init.headers).get('authorization'),
    })
    return Promise.resolve(new Response(JSON.stringify(body)))
  }
  return { fetch, sent }
}

async function aToken(): Promise<Token> {
  const net = new Network()
  const [x] = await guardians(net, ['x'])
  return mint(net, newWallet(), groupOf([x as never], 1))
}

describe('the wire format of section 10', async () => {
  const token = await aToken()
  const transition = { proposal: token, previous: token }
  const certificate = { token, previous: null }
  const line = {
    n: 1,
    type: 'creation',
    token_id: hash,
    state_hash: hash,
    spent: null,
    origin: null,
    date: DATE,
  }
  const entry = { type: 'raw', key, signature: 'AAAA' }
  const announcement = {
    token_id: hash,
    state_hash: hash,
    claimed_sequence: 0,
    ends_at: DATE,
    status: 'announced',
  }
  const owner = { n: 1, owner: { keys: [key], threshold: 1 } }
  const message = { id: 1, date: DATE, content: { ephemeral: key, ciphertext: 'AAAA' } }
  const info = {
    key,
    name: 'x',
    url: 'https://x.test',
    version: 'chirographe/1',
    policy: { open: true },
    rotations: [],
  }

  const routes: {
    name: string
    call: (client: HttpGuardian) => Promise<unknown>
    method: string
    path: string
    body?: unknown
    session?: string
    answer: unknown
    result?: unknown
  }[] = [
    {
      name: 'info',
      call: (c) => c.info(),
      method: 'GET',
      path: '/.well-known/guardian',
      answer: info,
    },
    { name: 'head', call: (c) => c.head(), method: 'GET', path: '/ledger/head', answer: head },
    {
      name: 'lines',
      call: (c) => c.lines(2, 10),
      method: 'GET',
      path: '/ledger/lines?from=2&limit=10',
      answer: { lines: [line] },
      result: [line],
    },
    {
      name: 'inclusion proof',
      call: (c) => c.inclusionProof(1, 2),
      method: 'GET',
      path: '/ledger/proof?line=1&size=2',
      answer: { path: [hash] },
      result: [hash],
    },
    {
      name: 'consistency proof',
      call: (c) => c.consistencyProof(1, 2),
      method: 'GET',
      path: '/ledger/consistency?from=1&to=2',
      answer: { path: [hash] },
      result: [hash],
    },
    {
      name: 'token head',
      call: (c) => c.tokenHead(hash),
      method: 'GET',
      path: `/tokens/${hash}/head`,
      answer: { here: true, state_hash: hash, n: 1, sequence: 0 },
    },
    {
      name: 'create',
      call: (c) => c.create(token),
      method: 'POST',
      path: '/tokens/create',
      body: token,
      answer: token,
    },
    {
      name: 'validate',
      call: (c) => c.validate(token),
      method: 'POST',
      path: '/tokens/validate',
      body: token,
      answer: token,
    },
    {
      name: 'enter',
      call: (c) => c.enter(transition),
      method: 'POST',
      path: '/tokens/enter',
      body: transition,
      answer: { incoming_guardian: entry },
    },
    {
      name: 'certify',
      call: (c) => c.certify(certificate),
      method: 'POST',
      path: '/tokens/certify',
      body: certificate,
      answer: { line: null },
    },
    {
      name: 'announcements',
      call: (c) => c.announcements(),
      method: 'GET',
      path: '/recovery/announcements',
      answer: { announcements: [announcement] },
      result: [announcement],
    },
    {
      name: 'recovery request',
      call: (c) => c.requestRecovery(transition),
      method: 'POST',
      path: '/recovery/request',
      body: transition,
      answer: { ends_at: DATE, line: 1 },
    },
    {
      name: 'recovery opposition',
      call: (c) => c.oppose(certificate),
      method: 'POST',
      path: '/recovery/oppose',
      body: certificate,
      answer: { line: 1 },
    },
    {
      name: 'recovery end',
      call: (c) => c.finalizeRecovery({ state_hash: hash }),
      method: 'POST',
      path: '/recovery/finalize',
      body: { state_hash: hash },
      answer: token,
    },
    {
      name: 'owners',
      call: (c) => c.owners(1, 500),
      method: 'GET',
      path: '/owners?from=1&limit=500',
      answer: { owners: [owner] },
      result: [owner],
    },
    {
      name: 'deposit',
      call: (c) => c.deposit(key, message.content),
      method: 'POST',
      path: `/mailbox/${key}`,
      body: message.content,
      answer: { id: 1 },
    },
    {
      name: 'messages',
      call: (c) => c.messages(key, 'session'),
      method: 'GET',
      path: `/mailbox/${key}`,
      session: 'session',
      answer: { messages: [message] },
      result: [message],
    },
    {
      name: 'message removal',
      call: (c) => c.deleteMessage(key, 1, 'session'),
      method: 'DELETE',
      path: `/mailbox/${key}/1`,
      session: 'session',
      answer: { ok: true },
      result: undefined,
    },
    {
      name: 'tokens of an owner',
      call: (c) => c.tokensOf(key, 'session'),
      method: 'GET',
      path: `/owners/${key}/tokens`,
      session: 'session',
      answer: { tokens: [token] },
      result: [token],
    },
  ]

  for (const route of routes) {
    it(route.name, async () => {
      const { fetch, sent } = stub(route.answer)
      const result = await route.call(new HttpGuardian('https://x.test', { fetch }))
      expect(sent).toEqual([
        {
          method: route.method,
          path: route.path,
          body: route.body ?? null,
          authorization: route.session ? `Bearer ${route.session}` : null,
        },
      ])
      expect(result).toEqual('result' in route ? route.result : route.answer)
    })
  }

  it('authenticates by signing the challenge', async () => {
    const signer = generateSigner()
    const challenge = 'AAAA'
    const sent: unknown[] = []
    const fetch: Fetch = (url, init) => {
      sent.push(JSON.parse(init.body as string))
      const answer = url.endsWith('/auth/challenge') ? { challenge } : { session: 'session' }
      return Promise.resolve(new Response(JSON.stringify(answer)))
    }
    const session = await new HttpGuardian('https://x.test', { fetch }).authenticate(signer)
    expect(session).toBe('session')
    expect(sent).toEqual([
      { key: signer.key },
      { key: signer.key, challenge, signature: expect.any(String) as string },
    ])
  })

  it('reaches any url through a directory', async () => {
    const { fetch, sent } = stub(head)
    await httpDirectory({ fetch })('https://y.test').head()
    expect(sent[0]?.path).toBe('/ledger/head')
  })

  it('keeps the details of a refusal', async () => {
    const moved_to = { members: [{ key, url: 'https://y.test' }], threshold: 1 }
    const fetch: Fetch = () =>
      Promise.resolve(
        new Response(JSON.stringify({ error: 'TOKEN_MOVED', message: 'moved', moved_to }), {
          status: 409,
        }),
      )
    await expect(new HttpGuardian('https://x.test', { fetch }).head()).rejects.toMatchObject({
      code: 'TOKEN_MOVED',
      status: 409,
      details: { moved_to },
    })
  })
})

describe('the witness routes', () => {
  const guardian = {
    key,
    url: 'https://x.test',
    last_response: DATE,
    head: { guardian: key, n: 1, root: ZERO_HASH, date: DATE, signature: 'AAAA' },
    frauds: [{ guardian: key, reason: 'fork', head_a: head, head_b: null, date: DATE }],
  }

  it('reads the witness identity', async () => {
    const { fetch, sent } = stub({ key, name: 'w' })
    expect(await new HttpWitness('https://w.test', { fetch }).info()).toEqual({ key, name: 'w' })
    expect(sent[0]?.path).toBe('/.well-known/witness')
  })

  it('lists guardians', async () => {
    const { fetch, sent } = stub({ guardians: [guardian] })
    expect(await new HttpWitness('https://w.test', { fetch }).guardians()).toEqual([guardian])
    expect(sent[0]?.path).toBe('/guardians')
  })

  it('submits heads', async () => {
    const { fetch, sent } = stub({ ok: true, fraud: null })
    const client = new HttpWitness('https://w.test', { fetch })
    expect(await client.submitHead(key, head)).toEqual({ ok: true, fraud: null })
    expect(sent[0]).toMatchObject({ method: 'POST', path: '/heads', body: { guardian: key, head } })
  })
})
