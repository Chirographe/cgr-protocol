import { describe, expect, it, vi } from 'vitest'
import {
  Guardian,
  MemoryGuardianStore,
  checkLedger,
  checkVoteLine,
  commit,
  hashOf,
  memoryKeyring,
  tokenOf,
} from '@chirographe/core'
import { heldAt, newToken, people } from '../../core/test/support/tokens.ts'
import { directory, refusal, serve } from './support.ts'

const { alice } = people('alice')
const segment = encodeURIComponent

describe('guardian reads', () => {
  it('serves the ledger, verifiable proofs and recorded transitions', async () => {
    const { client, group, guardian } = await serve()
    const before = await client.head()
    expect(before.n).toBe(0)

    const minted = heldAt(await commit(directory, await newToken({ group, owner: alice! }), []))
    expect(await client.info()).toMatchObject({ key: guardian.key, policy: { open: true } })
    expect(await client.lines(1, 500)).toHaveLength(1)
    const token = tokenOf(minted.output)
    expect(await client.tokenHead(token)).toMatchObject({ here: true, sequence: 0 })

    const status = await checkLedger(client, guardian.key, before)
    expect(status.ok).toBe(true)
    if (!status.ok) return
    const vote = minted.transition.guardians![0]!
    expect(await checkVoteLine(client, hashOf(minted.transition.body), vote, status.head)).toBe(
      true,
    )
    expect(await client.inclusionProof(1, 1)).toEqual([])
    expect(await client.consistencyProof(0, 1)).toEqual([])

    const recorded = await client.transition(hashOf(minted.transition.body))
    expect(recorded.body).toEqual(minted.transition.body)
    expect(await client.claims(hashOf(minted.output))).toEqual([])
    expect(await client.notices()).toEqual([])
  })

  it('reports refusals with their code, status and body', async () => {
    const { address, client } = await serve()
    await expect(client.tokenHead(hashOf('unknown'))).rejects.toEqual(refusal('UNKNOWN', 404))
    await expect(client.transition(hashOf('unknown'))).rejects.toEqual(refusal('UNKNOWN', 404))

    const response = await fetch(`${address}/tokens/${segment(hashOf('x'))}/head`)
    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({ error: 'UNKNOWN', message: 'unknown token' })
  })

  it('refuses malformed requests', async () => {
    const { address } = await serve()
    const post = (path: string, body: string) =>
      fetch(`${address}${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body,
      })
    const broken = await post('/transitions/validate', '{')
    expect(broken.status).toBe(400)
    expect(await broken.json()).toMatchObject({ error: 'INVALID_FORMAT' })

    for (const path of ['validate', 'enter', 'certify']) {
      expect((await post(`/transitions/${path}`, '{"transition":{}}')).status).toBe(400)
    }
    expect((await post('/recovery/notice', '{}')).status).toBe(400)
    expect((await post('/recovery/oppose', '[]')).status).toBe(400)
    expect((await post('/auth/challenge', '{"key":"nope"}')).status).toBe(400)
    expect((await fetch(`${address}/tokens/nope/head`)).status).toBe(400)
    expect((await fetch(`${address}/transitions/nope`)).status).toBe(400)
    expect((await fetch(`${address}/outputs/nope/claims`)).status).toBe(400)
    expect((await fetch(`${address}/ledger/lines?limit=501`)).status).toBe(400)
    expect((await fetch(`${address}/ledger/proof?line=2&size=1`)).status).toBe(400)
    expect((await fetch(`${address}/ledger/consistency?from=2&to=1`)).status).toBe(400)
    expect((await fetch(`${address}/ledger/proof?line=1&size=9`)).status).toBe(404)

    const missing = await fetch(`${address}/tokens/create`, { method: 'POST' })
    expect(missing.status).toBe(404)
    expect(await missing.json()).toMatchObject({ error: 'UNKNOWN' })
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

  it('stops signing once its ledger was rewritten, and says so', async () => {
    const [store, keyring] = [new MemoryGuardianStore(), memoryKeyring()]
    const first = await Guardian.open({ name: 'x', url: 'https://x.test', store, keyring })
    const group = { members: [{ key: first.key, url: first.url }], threshold: 1 }
    await first.validate({ transition: await newToken({ group, owner: alice! }), previous: [] })
    store.tamper(1, { date: '2020-01-01T00:00:00.000Z' })

    const { client } = await serve({ store, keyring })
    expect((await client.head()).locked).toBe(true)
    const transition = await newToken({ group, owner: alice! })
    await expect(client.certify({ transition, previous: [] })).rejects.toEqual(
      refusal('LEDGER_LOCKED', 503),
    )
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
