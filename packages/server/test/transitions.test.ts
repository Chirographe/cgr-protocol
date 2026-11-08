import { describe, expect, it } from 'vitest'
import {
  OPEN_POLICY,
  commit,
  composeTransition,
  continueOutput,
  findDoubleSpend,
  hashOf,
  outputId,
  predicates,
  signTransition,
  spendOf,
  tokenOf,
} from '@chirographe/core'
import { heldAt, move, newToken, people } from '../../core/test/support/tokens.ts'
import { START, directory, groupOf, refusal, serve, testClock } from './support.ts'

const { sig } = predicates
const { alice, bob, carol } = people('alice', 'bob', 'carol')
const HOUR = 3600

async function minted(group: Parameters<typeof newToken>[0]['group']) {
  return heldAt(await commit(directory, await newToken({ group, owner: alice! }), []))
}

describe('transitions over HTTP', () => {
  it('creates and transfers a token with a quorum of servers', async () => {
    const servers = await Promise.all(['a', 'b', 'c', 'd'].map((name) => serve({ name })))
    const group = groupOf(servers, 3)
    const token = await minted(group)
    expect(token.transition.guardians!.length).toBeGreaterThanOrEqual(3)

    const sold = await commit(directory, await move(token, [alice!], { lock: sig(bob!.key) }), [
      token.transition,
    ])
    const next = heldAt(sold)
    for (const { client } of servers) {
      const head = await client.tokenHead(tokenOf(next.output))
      expect(head).toEqual({ here: true, output: outputId(next.output), n: 2, sequence: 1 })
    }
  })

  it('refuses a double spend, and replays a recorded transition', async () => {
    const { client, group } = await serve()
    const token = await minted(group)
    const first = await move(token, [alice!], { lock: sig(bob!.key) })
    const second = await move(token, [alice!], { lock: sig(carol!.key) })
    const recorded = await commit(directory, first, [token.transition])
    expect(await commit(directory, first, [token.transition])).toEqual(recorded)
    await expect(commit(directory, second, [token.transition])).rejects.toEqual(
      refusal('ALREADY_SPENT', 409),
    )
    expect(findDoubleSpend(await client.lines(1, 500))).toBeNull()
    expect(await client.certify({ transition: recorded, previous: [token.transition] })).toEqual({
      line: null,
    })
  })

  it('moves a token to another group with entries and certificates', async () => {
    const from = await serve({ name: 'from' })
    const to = await serve({ name: 'to' })
    const token = await minted(from.group)
    const moved = await commit(directory, await move(token, [alice!], { group: to.group }), [
      token.transition,
    ])
    expect(moved.incoming).toHaveLength(1)
    const id = tokenOf(token.output)
    expect(await from.client.tokenHead(id)).toEqual({
      here: false,
      moved_to: to.group,
      sequence: 1,
    })
    expect(await to.client.tokenHead(id)).toMatchObject({ here: true, sequence: 1 })

    const held = heldAt(moved)
    const stale = await signTransition(
      composeTransition({
        group: from.group,
        inputs: [spendOf(held.output)],
        outputs: [continueOutput(held.output, { group: from.group })],
      }),
      [alice!],
    )
    const refused = from.client.validate({ transition: stale, previous: [moved] })
    await expect(refused).rejects.toEqual(refusal('TOKEN_MOVED', 409))
    await expect(refused).rejects.toMatchObject({ details: { moved_to: to.group } })

    const entry = to.client.enter({ transition: stale, previous: [moved] })
    await expect(entry).rejects.toEqual(refusal('INVALID_FORMAT', 400))
  })

  it('refuses by policy, and refuses an expired transition', async () => {
    const { clock } = testClock()
    const { client, group, guardian } = await serve({ clock })
    guardian.setPolicy({ ...OPEN_POLICY, issuers: [carol!.key] })
    expect((await client.info()).policy).toEqual({ open: false })
    const refused = commit(directory, await newToken({ group, owner: alice! }), [])
    await expect(refused).rejects.toEqual(refusal('POLICY_REFUSED', 403))

    guardian.setPolicy({ ...OPEN_POLICY, maxValiditySeconds: HOUR })
    const token = await minted(group)
    const spend = (validUntil: Date) =>
      signTransition(
        composeTransition({
          group,
          inputs: [spendOf(token.output)],
          outputs: [continueOutput(token.output)],
          validUntil,
        }),
        [alice!],
      )
    const far = await spend(new Date(START.getTime() + 2 * HOUR * 1000))
    await expect(commit(directory, far, [token.transition])).rejects.toEqual(
      refusal('POLICY_REFUSED', 403),
    )
    const past = await spend(new Date(START.getTime() - 1000))
    await expect(commit(directory, past, [token.transition])).rejects.toEqual(
      refusal('EXPIRED', 400),
    )
  })

  it('refuses a missing signature, and an unknown previous output', async () => {
    const { client, group } = await serve()
    const token = await minted(group)
    const unsigned = composeTransition({
      group,
      inputs: [spendOf(token.output)],
      outputs: [continueOutput(token.output)],
    })
    await expect(commit(directory, unsigned, [token.transition])).rejects.toEqual(
      refusal('NOT_AUTHORIZED', 400),
    )
    const orphan = await move(token, [alice!])
    await expect(client.validate({ transition: orphan, previous: [] })).rejects.toEqual(
      refusal('UNKNOWN', 404),
    )
    expect(await client.transition(hashOf(token.transition.body))).toMatchObject({
      body: token.transition.body,
    })
  })
})
