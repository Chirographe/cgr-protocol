import { describe, expect, it } from 'vitest'
import {
  OPEN_POLICY,
  ProtocolError,
  commit,
  composeTransition,
  signTransition,
  startOutput,
  composeRules,
  predicates,
  type Group,
  type Policy,
  type Signer,
} from '../src/index.ts'
import { Network } from './support/network.ts'
import { mint, move, people, transfer } from './support/tokens.ts'

const { sig } = predicates
const { alice, bob } = people('alice', 'bob')
const HOUR = 3600
const DAY = 24 * HOUR

const refused = (promise: Promise<unknown>, code: string) =>
  expect(promise).rejects.toSatisfy((e) => e instanceof ProtocolError && e.code === code)

const policy = (changes: Partial<Policy>): Policy => ({ ...OPEN_POLICY, ...changes })

async function expiring(group: Group, owner: Signer, validUntil: Date) {
  const rules = composeRules({ profile: 'test/1', issuer: sig(owner.key), group })
  const output = startOutput(rules, { lock: sig(owner.key) })
  return signTransition(composeTransition({ group, outputs: [output], validUntil }), [owner])
}

describe('guardian policy', () => {
  it('starts tokens only for the issuers it accepts', async () => {
    const net = new Network()
    const group = await net.group(['a'], 1)
    const guardian = net.node('a').guardian
    guardian.setPolicy(policy({ issuers: [bob!.key] }))
    expect((await guardian.info()).policy).toEqual({ open: false })
    await refused(mint(net, { group, owner: alice! }), 'POLICY_REFUSED')
    const minted = await mint(net, { group, owner: alice!, issuer: bob! })
    await transfer(net, minted, [alice!])
  })

  it('refuses arrivals from groups it does not accept, at entry and at certification', async () => {
    const net = new Network()
    const from = await net.group(['a'], 1)
    const to = await net.group(['x', 'y', 'z', 'w'], 3)
    const outsider = policy({ origins: [bob!.key] })
    const minted = await mint(net, { group: from, owner: alice! })
    const leaving = await move(minted, [alice!], { group: to })

    net.node('x').guardian.setPolicy(outsider)
    net.down.add('https://x.test')
    const final = await commit(net.directory, leaving, [minted.transition])
    net.down.delete('https://x.test')
    const submission = { transition: final, previous: [minted.transition] }
    await refused(net.node('x').guardian.certify(submission), 'POLICY_REFUSED')
    await refused(net.node('x').guardian.enter(submission), 'POLICY_REFUSED')
  })

  it('bounds validity periods, and refuses expired transitions', async () => {
    const net = new Network()
    const group = await net.group(['a'], 1)
    net.node('a').guardian.setPolicy(policy({ maxValiditySeconds: HOUR }))
    const far = await expiring(group, alice!, new Date(net.now.getTime() + DAY * 1000))
    await refused(commit(net.directory, far, []), 'POLICY_REFUSED')
    const past = await expiring(group, alice!, new Date(net.now.getTime() - 1000))
    await refused(commit(net.directory, past, []), 'EXPIRED')
    const near = await expiring(group, alice!, new Date(net.now.getTime() + HOUR * 1000))
    expect((await commit(net.directory, near, [])).guardians).toHaveLength(1)
  })
})
