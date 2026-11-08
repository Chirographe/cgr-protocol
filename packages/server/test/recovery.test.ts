import { describe, expect, it } from 'vitest'
import { announceTakeover, commit, opposeTakeover, predicates, tokenOf } from '@chirographe/core'
import { heldAt, move, newToken, people } from '../../core/test/support/tokens.ts'
import { directory, refusal, serve, testClock } from './support.ts'

const { sig } = predicates
const { alice, bob } = people('alice', 'bob')
const DELAY = 60

async function setup() {
  const { clock, advance } = testClock()
  const main = await serve({ name: 'main', clock })
  const rescue = await serve({ name: 'rescue', clock })
  const recovery = { group: rescue.group, delay_seconds: DELAY }
  const token = await newToken({ group: main.group, owner: alice!, recovery })
  const minted = heldAt(await commit(directory, token, []))
  const takeover = await move(minted, [alice!], { group: rescue.group }, rescue.group)
  return { main, rescue, minted, takeover, advance }
}

describe('recovery over HTTP', () => {
  it('takes custody of a token after an unopposed notice', async () => {
    const { rescue, minted, takeover, advance } = await setup()
    const previous = [minted.transition]
    const { ends_at } = await announceTakeover(directory, takeover, previous)
    expect(await rescue.client.notice({ transition: takeover, previous })).toMatchObject({
      ends_at,
    })
    expect(await rescue.client.notices()).toMatchObject([{ status: 'open', ends_at, sequence: 0 }])
    await expect(commit(directory, takeover, previous)).rejects.toEqual(
      refusal('POLICY_REFUSED', 403),
    )

    advance(DELAY)
    const final = await commit(directory, takeover, previous)
    const held = heldAt(final)
    expect(await rescue.client.tokenHead(tokenOf(held.output))).toMatchObject({ here: true })
    expect(await rescue.client.notices()).toMatchObject([{ status: 'completed' }])

    const next = await commit(directory, await move(held, [alice!], { lock: sig(bob!.key) }), [
      final,
    ])
    expect(next.body.outputs[0]?.sequence).toBe(2)
  })

  it('is stopped when the holder shows a later state', async () => {
    const { rescue, minted, takeover, advance } = await setup()
    const previous = [minted.transition]
    await expect(rescue.client.oppose({ transition: takeover, previous })).rejects.toEqual(
      refusal('UNKNOWN', 404),
    )
    await announceTakeover(directory, takeover, previous)
    const sold = await commit(
      directory,
      await move(minted, [alice!], { lock: sig(bob!.key) }),
      previous,
    )
    await expect(rescue.client.oppose({ transition: takeover, previous })).rejects.toEqual(
      refusal('NOT_AUTHORIZED', 400),
    )
    await opposeTakeover(directory, rescue.group, sold, previous)
    expect(await rescue.client.notices()).toMatchObject([{ status: 'opposed' }])

    advance(DELAY)
    await expect(commit(directory, takeover, previous)).rejects.toEqual(
      refusal('POLICY_REFUSED', 403),
    )
  })

  it('refuses a notice that is not a takeover, and a second open notice', async () => {
    const { rescue, minted, takeover } = await setup()
    const previous = [minted.transition]
    const plain = await move(minted, [alice!], { lock: sig(bob!.key) })
    await expect(announceTakeover(directory, plain, previous)).rejects.toEqual(
      refusal('INVALID_FORMAT', 400),
    )
    await announceTakeover(directory, takeover, previous)
    const other = await move(minted, [alice!], { group: rescue.group, data: 'other' }, rescue.group)
    await expect(announceTakeover(directory, other, previous)).rejects.toEqual(
      refusal('ALREADY_SPENT', 409),
    )
  })
})
