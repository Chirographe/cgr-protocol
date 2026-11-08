import { describe, expect, it } from 'vitest'
import { HttpGuardian, ProtocolError, Transport } from '../src/index.ts'

const BASE = 'https://x.test'
const BAD_GATEWAY = 502
const BAD_REQUEST = 400

const answering = (body: string, status = 200) =>
  new HttpGuardian(`${BASE}/`, { fetch: () => Promise.resolve(new Response(body, { status })) })

describe('transport', () => {
  it('treats an unknown failure as a plain error', async () => {
    const failing = answering('<html>bad gateway</html>', BAD_GATEWAY).head()
    await expect(failing).rejects.toThrow(`HTTP ${BAD_GATEWAY}`)
    await expect(failing).rejects.not.toBeInstanceOf(ProtocolError)
    const invented = answering('{"error":"NOT_A_CODE","message":"x"}', BAD_REQUEST).head()
    await expect(invented).rejects.not.toBeInstanceOf(ProtocolError)
  })

  it('keeps the details of a protocol error', async () => {
    const body = '{"error":"TOKEN_MOVED","message":"left","moved_to":null}'
    const refused = answering(body, 409).tokenHead('sha256:00')
    await expect(refused).rejects.toMatchObject({
      code: 'TOKEN_MOVED',
      details: { moved_to: null },
    })
  })

  it('does not trust the shape of an answer', async () => {
    await expect(answering('{"n":"1"}').head()).rejects.toThrow('invalid answer')
    await expect(answering('{"lines":[{"n":1}]}').lines(1, 1)).rejects.toThrow('invalid answer')
    await expect(answering('not json').info()).rejects.toThrow('invalid answer')
  })

  it('gives up on a server that hangs', async () => {
    const hanging = new Transport(BASE, {
      timeoutSeconds: 0.01,
      fetch: (_url, init) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => reject(new Error('timed out')))
        }),
    })
    await expect(hanging.delete('/x', 'session')).rejects.toThrow('timed out')
  })

  it('normalizes the base URL and sends sessions as bearer tokens', async () => {
    const calls: [string, RequestInit][] = []
    const client = new HttpGuardian(`${BASE}///`, {
      fetch: (url, init) => {
        calls.push([url, init])
        return Promise.resolve(new Response('{"path":[]}'))
      },
    })
    await client.consistencyProof(0, 3)
    await client.deleteMessage('p256:AAAA', 1, 'abc').catch(() => undefined)
    expect(calls.map(([url]) => url)).toEqual([
      `${BASE}/ledger/consistency?from=0&to=3`,
      `${BASE}/mailbox/p256%3AAAAA/1`,
    ])
    expect(calls[1]![1]).toMatchObject({
      method: 'DELETE',
      headers: { authorization: 'Bearer abc' },
    })
  })

  it('uses the global fetch by default', async () => {
    const original = globalThis.fetch
    globalThis.fetch = () => Promise.resolve(new Response('{"path":[]}'))
    try {
      expect(await new HttpGuardian(BASE).inclusionProof(1, 1)).toEqual([])
    } finally {
      globalThis.fetch = original
    }
  })
})
