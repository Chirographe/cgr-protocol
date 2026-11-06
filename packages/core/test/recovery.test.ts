import { beforeEach, describe, expect, it } from 'vitest'
import {
  Guardian,
  acceptProposal,
  commit,
  composeProposal,
  finalizeRecovery,
  requestRecovery,
  signersForState,
  validateToken,
  type Group,
  type Token,
  type Wallet,
} from '../src/index.ts'
import { Network, directAddress, groupOf, guardians, mint, newWallet } from './network.ts'

const DELAY = 86_400

describe('recovery', () => {
  let net: Network
  let main: Guardian[]
  let rescue: Guardian[]
  let rescueGroup: Group
  let alice: Wallet
  let token: Token

  beforeEach(async () => {
    net = new Network()
    main = await guardians(net, ['a', 'b', 'c', 'd'])
    rescue = await guardians(net, ['r1', 'r2', 'r3', 'r4'])
    rescueGroup = groupOf(rescue, 3)
    alice = newWallet()
    token = await mint(net, alice, groupOf(main, 3), {
      recovery: { group: rescueGroup, delay_seconds: DELAY },
    })
  })

  const signers = () => signersForState(alice, token.state)

  const sell = async (to: Wallet) => {
    const { keys, threshold } = directAddress(to)
    const proposal = await composeProposal(token, {
      signers: signers(),
      recipient: { owner: { keys, threshold } },
      expiresIn: 3600,
      now: net.now,
    })
    return commit(
      net.directory,
      await acceptProposal(proposal, signersForState(to, proposal.state)),
      token,
    )
  }

  it('takes over a token after the delay, with every guardian gone', async () => {
    for (const member of main) net.down.add(member.url)
    const { proposal, ends_at } = await requestRecovery(net.directory, token, signers())
    expect(Date.parse(ends_at)).toBe(net.now.getTime() + DELAY * 1000)

    await expect(finalizeRecovery(net.directory, proposal, token)).rejects.toMatchObject({
      code: 'POLICY_REFUSED',
    })

    net.advance(DELAY)
    const final = await finalizeRecovery(net.directory, proposal, token)
    expect(() => validateToken(final, { stage: 'final', previous: token.state })).not.toThrow()
    expect(final.state.owner).toEqual(token.state.owner)
    const [member] = rescue as [Guardian]
    expect((await member.lines(1, 5)).map((l) => l.type)).toEqual(['announcement', 'takeover'])
    expect(await member.tokenHead(token.state.token_id)).toMatchObject({ here: true })

    // A repeated call changes nothing.
    await finalizeRecovery(net.directory, proposal, token)
    expect(await member.lines(1, 5)).toHaveLength(2)
  })

  it('informs the old group when it comes back', async () => {
    const { proposal } = await requestRecovery(net.directory, token, signers())
    net.advance(DELAY)
    await finalizeRecovery(net.directory, proposal, token)
    expect(await (main[0] as Guardian).tokenHead(token.state.token_id)).toMatchObject({
      here: false,
    })
  })

  it('cannot take a sold token: the buyer opposes', async () => {
    const bob = newWallet()
    const sold = await sell(bob)
    const { proposal } = await requestRecovery(net.directory, token, signers())
    await Promise.all(rescue.map((r) => r.oppose({ token: sold, previous: token })))

    net.advance(DELAY)
    await expect(finalizeRecovery(net.directory, proposal, token)).rejects.toMatchObject({
      code: 'STATE_ALREADY_SPENT',
    })
    const [first] = await (rescue[0] as Guardian).announcements()
    expect(first?.status).toBe('opposed')
  })

  it('accepts a later state as opposition', async () => {
    const bob = newWallet()
    const charlie = newWallet()
    const sold = await sell(bob)
    const { keys, threshold } = directAddress(charlie)
    const resale = await composeProposal(sold, {
      signers: signersForState(bob, sold.state),
      recipient: { owner: { keys, threshold } },
      expiresIn: 3600,
      now: net.now,
    })
    const later = await commit(
      net.directory,
      await acceptProposal(resale, signersForState(charlie, resale.state)),
      sold,
    )
    await requestRecovery(net.directory, token, signers())
    const [rescuer] = rescue as [Guardian]
    await expect(rescuer.oppose({ token: later, previous: null })).resolves.toBeDefined()
  })

  it('refuses a request that changes the owner', async () => {
    const thief = newWallet()
    const { keys, threshold } = directAddress(thief)
    const proposal = await composeProposal(token, {
      signers: signers(),
      recipient: { owner: { keys, threshold } },
      guardian: rescueGroup,
      expiresIn: null,
      takeover: true,
      now: net.now,
    })
    await expect(
      (rescue[0] as Guardian).requestRecovery({ proposal, previous: token }),
    ).rejects.toMatchObject({ code: 'INVALID_FORMAT' })
  })

  it('refuses a recovery sent straight to the guardians, around the delay', async () => {
    const proposal = await composeProposal(token, {
      signers: signers(),
      guardian: rescueGroup,
      expiresIn: null,
      takeover: true,
      now: net.now,
    })
    await expect((main[0] as Guardian).validate(proposal)).rejects.toMatchObject({
      code: 'INVALID_FORMAT',
    })
    expect(await (main[0] as Guardian).tokenHead(token.state.token_id)).toMatchObject({
      here: true,
    })
  })

  it('refuses a request by anyone but the owner', async () => {
    const stranger = newWallet()
    await expect(
      requestRecovery(
        net.directory,
        token,
        signersForState(stranger, {
          ...token.state,
          owner: { keys: directAddress(stranger).keys, threshold: 1 },
        }),
      ),
    ).rejects.toMatchObject({ code: 'INVALID_SIGNATURE' })
  })

  it('refuses an opposition without proof', async () => {
    const { proposal } = await requestRecovery(net.directory, token, signers())
    const [rescuer] = rescue as [Guardian]
    await expect(rescuer.oppose({ token: token, previous: null })).rejects.toMatchObject({
      code: 'INVALID_SIGNATURE',
    })
    await expect(rescuer.oppose({ token: proposal, previous: null })).rejects.toMatchObject({
      code: 'INVALID_SIGNATURE',
    })
  })

  it('refuses an opposition when nothing is open', async () => {
    await expect(
      (rescue[0] as Guardian).oppose({ token: token, previous: null }),
    ).rejects.toMatchObject({ code: 'UNKNOWN_STATE' })
  })

  it('keeps one open request per token, and repeats it', async () => {
    const first = await requestRecovery(net.directory, token, signers())
    const again = await (rescue[0] as Guardian).requestRecovery({
      proposal: first.proposal,
      previous: token,
    })
    expect(again.ends_at).toBe(first.ends_at)
    net.advance(1)
    await expect(requestRecovery(net.directory, token, signers())).rejects.toMatchObject({
      code: 'STATE_ALREADY_SPENT',
    })
  })

  it('refuses a request outside the recovery group', async () => {
    const { proposal } = await requestRecovery(net.directory, token, signers())
    await expect(
      (main[0] as Guardian).requestRecovery({ proposal, previous: token }),
    ).rejects.toMatchObject({ code: 'INVALID_FORMAT' })
  })

  it('needs a recovery group', async () => {
    const plain = await mint(net, alice, groupOf(main, 3))
    await expect(requestRecovery(net.directory, plain, signers())).rejects.toThrow(
      'no recovery group',
    )
    const forged = await composeProposal(plain, {
      signers: signers(),
      expiresIn: null,
      now: net.now,
    })
    await expect(
      (rescue[0] as Guardian).requestRecovery({ proposal: forged, previous: plain }),
    ).rejects.toMatchObject({ code: 'INVALID_FORMAT' })
  })

  it('refuses to finalize an unknown request', async () => {
    await expect(
      (rescue[0] as Guardian).finalizeRecovery({ state_hash: token.state.token_id }),
    ).rejects.toMatchObject({ code: 'UNKNOWN_STATE' })
  })
})
