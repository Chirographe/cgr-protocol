import { describe, expect, it } from 'vitest'
import {
  Guardian,
  ProtocolError,
  claimOf,
  commit,
  composeTransition,
  findDoubleSpend,
  isFinal,
  outputId,
  predicates,
  signTransition,
  spendOf,
  tokenOf,
  addProofs,
  regroup,
  bodyHash,
  hasQuorum,
  type Transition,
} from '../src/index.ts'
import { Network } from './support/network.ts'
import { TEST_SCHEME, commitmentOf, nullifierOf, rootOf } from './support/scheme.ts'
import { heldAt, mint, move, people, transfer } from './support/tokens.ts'

const { sig, member } = predicates
const { alice, bob, carol } = people('alice', 'bob', 'carol')

const refused = (promise: Promise<unknown>, code: string) =>
  expect(promise).rejects.toSatisfy((e) => e instanceof ProtocolError && e.code === code)

describe('guardian', () => {
  it('creates, transfers and finalizes with a quorum', async () => {
    const net = new Network()
    const group = await net.group(['a', 'b', 'c', 'd'], 3)
    const minted = await mint(net, { group, owner: alice! })
    expect(await isFinal(minted.transition, [])).toBe(true)

    const moved = await transfer(net, minted, [alice!], { lock: sig(bob!.key) })
    expect(await isFinal(moved.transition, [minted.transition])).toBe(true)
    const head = await net.node('a').guardian.tokenHead(tokenOf(moved.output))
    expect(head).toMatchObject({ here: true, output: outputId(moved.output), sequence: 1 })
  })

  it('refuses a double spend and replays a recorded transition', async () => {
    const net = new Network()
    const group = await net.group(['a'], 1)
    const minted = await mint(net, { group, owner: alice! })
    const first = await move(minted, [alice!], { lock: sig(bob!.key) })
    const second = await move(minted, [alice!], { lock: sig(carol!.key) })
    const recorded = await commit(net.directory, first, [minted.transition])
    expect(await commit(net.directory, first, [minted.transition])).toEqual(recorded)
    await refused(commit(net.directory, second, [minted.transition]), 'ALREADY_SPENT')
    const lines = await net.node('a').guardian.lines(1, 100)
    expect(findDoubleSpend(lines)).toBeNull()
  })

  it('ends a token spent without continuation', async () => {
    const net = new Network()
    const group = await net.group(['a'], 1)
    const minted = await mint(net, { group, owner: alice! })
    const end = await signTransition(
      composeTransition({ group, inputs: [spendOf(minted.output)] }),
      [alice!],
    )
    await commit(net.directory, end, [minted.transition])
    const head = await net.node('a').guardian.tokenHead(tokenOf(minted.output))
    expect(head).toEqual({ here: false, moved_to: null, sequence: 1 })
    await refused(transfer(net, minted, [alice!]), 'ALREADY_SPENT')
  })

  it('accepts one claim per nullifier, and lists them', async () => {
    const net = new Network()
    const group = await net.group(['a', 'b', 'c', 'd'], 3)
    const members = ['v1', 'v2'].map(commitmentOf)
    const root = rootOf(members)
    const election = await mint(net, { group, owner: alice!, claim: member(root, TEST_SCHEME) })
    const scope = outputId(election.output)

    const ballot = async (secret: string, choice: string): Promise<Transition> => {
      const nullifier = nullifierOf(secret, scope)
      const t = composeTransition({
        group,
        inputs: [claimOf(election.output, nullifier)],
        data: { choice },
      })
      return addProofs(t, [
        { scheme: TEST_SCHEME, nullifier, proof: { secret, members, signal: bodyHash(t) } },
      ])
    }
    await commit(net.directory, await ballot('v1', 'yes'), [election.transition])
    await commit(net.directory, await ballot('v2', 'no'), [election.transition])
    await refused(
      commit(net.directory, await ballot('v1', 'no'), [election.transition]),
      'ALREADY_SPENT',
    )
    await refused(
      commit(net.directory, await ballot('intruder', 'no'), [election.transition]),
      'NOT_AUTHORIZED',
    )

    const claims = await net.node('b').guardian.claims(scope)
    expect(claims.map((c) => c.body.data)).toEqual([{ choice: 'yes' }, { choice: 'no' }])
    expect(claims.every(hasQuorum)).toBe(true)
    const head = await net.node('a').guardian.tokenHead(tokenOf(election.output))
    expect(head).toMatchObject({ here: true, output: scope })
  })

  it('moves a token to another group with entries and certificates', async () => {
    const net = new Network()
    const from = await net.group(['a', 'b', 'c', 'd'], 3)
    const to = await net.group(['x', 'y', 'z', 'w'], 3)
    const minted = await mint(net, { group: from, owner: alice! })
    const moved = await commit(net.directory, await move(minted, [alice!], { group: to }), [
      minted.transition,
    ])
    expect(moved.incoming?.length).toBeGreaterThanOrEqual(3)

    const left = await net.node('a').guardian.tokenHead(tokenOf(minted.output))
    expect(left).toMatchObject({ here: false, sequence: 1 })
    const held = heldAt(moved)
    const arrived = await net.node('x').guardian.tokenHead(tokenOf(held.output))
    expect(arrived).toMatchObject({ here: true, output: outputId(held.output) })

    const next = await transfer(net, held, [alice!], { lock: sig(bob!.key) })
    expect(next.output.group).toEqual(to)
  })

  it('changes group while keeping some members, or only the threshold', async () => {
    const net = new Network()
    const [a, b, c, d, e] = await Promise.all(['a', 'b', 'c', 'd', 'e'].map((n) => net.add(n)))
    const member = (g: Guardian | undefined) => ({ key: g!.key, url: g!.url })
    const from = { members: [a, b, c, d].map(member), threshold: 3 }
    const to = { members: [a, b, c, e].map(member), threshold: 3 }
    const minted = await mint(net, { group: from, owner: alice! })
    const moved = heldAt(
      await commit(net.directory, await signTransition(regroup(minted.output, to), [alice!]), [
        minted.transition,
      ]),
    )
    for (const name of ['a', 'e']) {
      expect(await net.node(name).guardian.tokenHead(tokenOf(moved.output))).toMatchObject({
        here: true,
        sequence: 1,
      })
    }
    expect(await net.node('d').guardian.tokenHead(tokenOf(moved.output))).toMatchObject({
      here: false,
    })
    const stricter = { ...to, threshold: 4 }
    const again = await commit(
      net.directory,
      await signTransition(regroup(moved.output, stricter), [alice!]),
      [moved.transition],
    )
    expect(again.body.outputs[0]?.group.threshold).toBe(4)
  })

  it('lets a late member catch up from the previous transitions', async () => {
    const net = new Network()
    const group = await net.group(['a', 'b', 'c', 'd'], 3)
    net.down.add('https://d.test')
    const minted = await mint(net, { group, owner: alice! })
    net.down.delete('https://d.test')
    net.down.add('https://a.test')
    const moved = await transfer(net, minted, [alice!], { lock: sig(bob!.key) })
    const head = await net.node('d').guardian.tokenHead(tokenOf(moved.output))
    expect(head).toMatchObject({ here: true, sequence: 1 })
  })

  it('refuses a token started twice, and a member that is not in the group', async () => {
    const net = new Network()
    const group = await net.group(['a'], 1)
    const other = await net.group(['b'], 1)
    const minted = await mint(net, { group, owner: alice! })
    await refused(
      net.node('b').guardian.validate({ transition: minted.transition, previous: [] }),
      'INVALID_FORMAT',
    )
    expect(other.members).toHaveLength(1)
    const again = { ...minted.transition, guardians: [] }
    const replayed = await net.node('a').guardian.validate({ transition: again, previous: [] })
    expect(replayed.guardians).toHaveLength(1)
  })
})
