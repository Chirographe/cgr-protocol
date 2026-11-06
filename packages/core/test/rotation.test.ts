import { describe, expect, it } from 'vitest'
import {
  Guardian,
  acceptProposal,
  checkLedger,
  commit,
  composeProposal,
  followRotations,
  generateSigner,
  isValidRotation,
  keyHistory,
  signRotation,
  signersForState,
  validateToken,
} from '../src/index.ts'
import { Network, directAddress, groupOf, guardians, mint, newWallet } from './network.ts'

describe('key rotation', () => {
  it('keeps tokens and the ledger valid', async () => {
    const net = new Network()
    const [x] = (await guardians(net, ['x'])) as [Guardian]
    const original = x.key
    const alice = newWallet()
    const bob = newWallet()
    const token = await mint(net, alice, groupOf([x], 1))

    await x.rotate()
    expect(x.key).not.toBe(original)
    expect((await x.lines(1, 5)).at(-1)).toMatchObject({ type: 'rotation' })
    expect((await checkLedger(x, original, null)).ok).toBe(true)
    expect((await x.info()).rotations).toHaveLength(1)

    const { keys, threshold } = directAddress(bob)
    const proposal = await composeProposal(token, {
      signers: signersForState(alice, token.state),
      recipient: { owner: { keys, threshold } },
      expiresIn: 3600,
      now: net.now,
    })
    const final = await commit(
      net.directory,
      await acceptProposal(proposal, signersForState(bob, proposal.state)),
      token,
    )
    expect(final.signatures.guardians?.[0]?.rotations).toHaveLength(1)
    expect(() => validateToken(final, { stage: 'final', previous: token.state })).not.toThrow()
  })

  it('signs entries with its rotations', async () => {
    const net = new Network()
    const [x, y] = (await guardians(net, ['x', 'y'])) as [Guardian, Guardian]
    const alice = newWallet()
    const token = await mint(net, alice, groupOf([x], 1))
    const target = groupOf([y], 1)
    await y.rotate()
    const next = await composeProposal(token, {
      signers: signersForState(alice, token.state),
      guardian: target,
      expiresIn: 3600,
      now: net.now,
    })
    const final = await commit(net.directory, next, token)
    expect(final.signatures.incoming_guardians?.[0]?.rotations).toHaveLength(1)
  })
})

describe('key history', () => {
  it('follows a chain of rotations', async () => {
    const [a, b, c] = [generateSigner(), generateSigner(), generateSigner()]
    const rotations = [await signRotation(a, b), await signRotation(b, c)]
    expect(keyHistory(c.key, rotations)).toEqual([a.key, b.key, c.key])
    expect(keyHistory(c.key)).toEqual([c.key])
    expect(followRotations(a.key, rotations)).toBe(c.key)
  })

  it('rejects a broken chain', async () => {
    const [a, b, c] = [generateSigner(), generateSigner(), generateSigner()]
    const rotation = await signRotation(a, b)
    expect(keyHistory(c.key, [rotation])).toEqual([])
    const forged = { ...rotation, previous_signature: rotation.next_signature }
    expect(isValidRotation(forged)).toBe(false)
    expect(keyHistory(b.key, [forged])).toEqual([])
    expect(followRotations(a.key, [forged])).toBeNull()
  })
})
