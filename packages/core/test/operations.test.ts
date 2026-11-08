import { describe, expect, it } from 'vitest'
import {
  ProtocolError,
  announceTakeover,
  commit,
  opposeTakeover,
  predicates,
} from '../src/index.ts'
import { Network } from './support/network.ts'
import { mint, move, newToken, people, transfer } from './support/tokens.ts'

const { sig } = predicates
const { alice, bob } = people('alice', 'bob')
const DELAY = 60

const refused = (promise: Promise<unknown>, code: string) =>
  expect(promise).rejects.toSatisfy((e) => e instanceof ProtocolError && e.code === code)

describe('guardian operations', () => {
  it('refuses a second start of a known token', async () => {
    const net = new Network()
    const group = await net.group(['a'], 1)
    const first = await newToken({ group, owner: alice! })
    await commit(net.directory, first, [])
    const output = { ...first.body.outputs[0]!, data: 'other' }
    const twin = { ...first, body: { ...first.body, outputs: [output] } }
    await refused(
      net.node('a').guardian.validate({ transition: twin, previous: [] }),
      'ALREADY_SPENT',
    )
  })

  it('refuses to enter a token already held here', async () => {
    const net = new Network()
    const from = await net.group(['a'], 1)
    const to = await net.group(['x'], 1)
    const minted = await mint(net, { group: from, owner: alice! })
    await commit(net.directory, await move(minted, [alice!], { group: to }), [minted.transition])
    const again = await move(minted, [alice!], { group: to, data: 'again' })
    const x = net.node('x').guardian
    await refused(x.enter({ transition: again, previous: [minted.transition] }), 'ALREADY_SPENT')
  })

  it('certifies only final transitions that concern it', async () => {
    const net = new Network()
    const group = await net.group(['a'], 1)
    await net.group(['b'], 1)
    const minted = await mint(net, { group, owner: alice! })
    const next = await move(minted, [alice!], { lock: sig(bob!.key) })
    const b = net.node('b').guardian
    await refused(b.certify({ transition: minted.transition, previous: [] }), 'INVALID_FORMAT')
    const a = net.node('a').guardian
    const unfinished = { ...minted.transition, guardians: [] }
    await refused(a.certify({ transition: next, previous: [unfinished] }), 'NOT_AUTHORIZED')
    expect(await a.certify({ transition: minted.transition, previous: [] })).toEqual({ line: null })
  })

  it('replays a notice, and refuses oppositions that prove nothing', async () => {
    const net = new Network()
    const group = await net.group(['a'], 1)
    const rescue = await net.group(['r'], 1)
    const recovery = { group: rescue, delay_seconds: DELAY }
    const minted = await mint(net, { group, owner: alice!, recovery })
    const takeover = await move(minted, [alice!], { group: rescue }, rescue)
    const r = net.node('r').guardian

    await refused(r.oppose({ transition: minted.transition, previous: [] }), 'UNKNOWN')
    const first = await announceTakeover(net.directory, takeover, [minted.transition])
    expect(await announceTakeover(net.directory, takeover, [minted.transition])).toEqual(first)
    await refused(opposeTakeover(net.directory, rescue, minted.transition, []), 'NOT_AUTHORIZED')
    const sold = await transfer(net, minted, [alice!], { lock: sig(bob!.key) })
    const later = await transfer(net, sold, [bob!])
    await opposeTakeover(net.directory, rescue, later.transition, [sold.transition])
    expect((await r.notices())[0]?.status).toBe('opposed')
  })

  it('serves proofs only within the ledger', async () => {
    const net = new Network()
    const group = await net.group(['a'], 1)
    await mint(net, { group, owner: alice! })
    const a = net.node('a').guardian
    await refused(a.inclusionProof(1, 2), 'UNKNOWN')
    await refused(a.consistencyProof(1, 2), 'UNKNOWN')
    await refused(a.transition(`sha256:${'0'.repeat(64)}`), 'UNKNOWN')
  })
})
