import { describe, expect, it } from 'vitest'
import {
  ProtocolError,
  announceTakeover,
  commit,
  opposeTakeover,
  predicates,
  tokenOf,
} from '../src/index.ts'
import { Network } from './support/network.ts'
import { heldAt, mint, move, people } from './support/tokens.ts'

const { sig } = predicates
const { alice, bob } = people('alice', 'bob')
const DELAY = 3600

async function setup() {
  const net = new Network()
  const group = await net.group(['a'], 1)
  const rescue = await net.group(['r', 's', 't', 'u'], 3)
  const minted = await mint(net, {
    group,
    owner: alice!,
    recovery: { group: rescue, delay_seconds: DELAY },
  })
  const takeover = await move(minted, [alice!], { group: rescue }, rescue)
  return { net, group, rescue, minted, takeover }
}

const refused = (promise: Promise<unknown>, code: string) =>
  expect(promise).rejects.toSatisfy((e) => e instanceof ProtocolError && e.code === code)

describe('recovery', () => {
  it('takes custody after an unopposed notice', async () => {
    const { net, minted, takeover } = await setup()
    net.down.add('https://a.test')
    const { ends_at } = await announceTakeover(net.directory, takeover, [minted.transition])
    expect(Date.parse(ends_at) - net.now.getTime()).toBe(DELAY * 1000)
    await refused(commit(net.directory, takeover, [minted.transition]), 'POLICY_REFUSED')

    net.advance(DELAY)
    const final = await commit(net.directory, takeover, [minted.transition])
    const held = heldAt(final)
    const head = await net.node('r').guardian.tokenHead(tokenOf(held.output))
    expect(head).toMatchObject({ here: true, sequence: 1 })
    const notices = await net.node('s').guardian.notices()
    expect(notices[0]?.status).toBe('completed')

    const after = await commit(net.directory, await move(held, [alice!], { lock: sig(bob!.key) }), [
      final,
    ])
    expect(after.body.outputs[0]?.sequence).toBe(2)
  })

  it('is stopped by a later state', async () => {
    const { net, minted, takeover, rescue } = await setup()
    await announceTakeover(net.directory, takeover, [minted.transition])
    const sold = await commit(
      net.directory,
      await move(minted, [alice!], { lock: sig(bob!.key) }),
      [minted.transition],
    )
    await opposeTakeover(net.directory, rescue, sold, [])
    const notices = await net.node('r').guardian.notices()
    expect(notices[0]?.status).toBe('opposed')
    net.advance(DELAY)
    await refused(commit(net.directory, takeover, [minted.transition]), 'POLICY_REFUSED')
  })

  it('refuses a notice that is not a takeover, and a second open notice', async () => {
    const { net, minted, takeover, rescue } = await setup()
    const plain = await move(minted, [alice!], { lock: sig(bob!.key) })
    await refused(announceTakeover(net.directory, plain, [minted.transition]), 'INVALID_FORMAT')
    await announceTakeover(net.directory, takeover, [minted.transition])
    const other = await move(minted, [alice!], { group: rescue, data: 'other' }, rescue)
    await refused(announceTakeover(net.directory, other, [minted.transition]), 'ALREADY_SPENT')
  })
})
