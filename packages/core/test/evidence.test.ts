import { describe, expect, it } from 'vitest'
import {
  ProtocolError,
  hashOf,
  isFinal,
  isTakeover,
  mergeEvidence,
  predicates,
  resolveInputs,
  revealPreimages,
  signTransition,
  validateTransition,
  type Transition,
} from '../src/index.ts'
import { Network } from './support/network.ts'
import { mint, move, newToken, people } from './support/tokens.ts'

const { sig, hashLock, all } = predicates
const { alice, bob } = people('alice', 'bob')
const SECRET = { secret: 'open sesame' }

const refused = (promise: Promise<unknown>, code: string) =>
  expect(promise).rejects.toSatisfy((e) => e instanceof ProtocolError && e.code === code)

describe('evidence', () => {
  it('merges what two parties added, once per signature and preimage', async () => {
    const net = new Network()
    const group = await net.group(['a'], 1)
    const lock = all(sig(alice!.key), sig(bob!.key), hashLock(hashOf(SECRET)))
    const minted = await mint(net, { group, owner: alice!, lock })
    const unsigned = await move(minted, [])
    const byAlice = revealPreimages(await signTransition(unsigned, [alice!]), [SECRET])
    const byBob = revealPreimages(await signTransition(unsigned, [bob!]), [SECRET])
    const merged = mergeEvidence(byAlice, byBob)
    expect(merged.evidence.signatures.map((s) => s.key)).toEqual([alice!.key, bob!.key])
    expect(merged.evidence.preimages).toEqual([SECRET])
    await validateTransition(merged, [minted.transition], 'authorized', net.now)
    await refused(
      validateTransition(byAlice, [minted.transition], 'authorized', net.now),
      'NOT_AUTHORIZED',
    )
    expect(() => mergeEvidence(byAlice, minted.transition)).toThrow(ProtocolError)
  })
})

describe('validity', () => {
  it('tells final transitions apart, and rethrows what is not a refusal', async () => {
    const net = new Network()
    const group = await net.group(['a'], 1)
    const minted = await mint(net, { group, owner: alice! })
    expect(await isFinal(minted.transition, [])).toBe(true)
    expect(await isFinal({ ...minted.transition, guardians: [] }, [])).toBe(false)
    const broken = { ...minted.transition, body: null } as unknown as Transition
    await expect(isFinal(broken, [])).rejects.toBeInstanceOf(TypeError)
  })

  it('recognizes a takeover, and refuses an input held by another group', async () => {
    const net = new Network()
    const group = await net.group(['a'], 1)
    const rescue = await net.group(['r'], 1)
    const minted = await mint(net, {
      group,
      owner: alice!,
      recovery: { group: rescue, delay_seconds: 1 },
    })
    const takeover = await move(minted, [alice!], { group: rescue }, rescue)
    expect(isTakeover(resolveInputs(takeover, [minted.transition]), takeover.body)).toBe(true)
    const stray = await newToken({ group: rescue, owner: alice! })
    expect(isTakeover(resolveInputs(stray, []), stray.body)).toBe(false)

    const other = await net.group(['o'], 1)
    const foreign = await move(minted, [alice!], {}, other)
    await refused(
      validateTransition(foreign, [minted.transition], 'entry', net.now),
      'NOT_AUTHORIZED',
    )
  })
})
