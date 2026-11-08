import { describe, expect, it } from 'vitest'
import {
  ProtocolError,
  composeRules,
  composeTransition,
  mergeEvidence,
  continueOutput,
  generateSigner,
  predicates,
  signTransition,
  spendOf,
  startOutput,
  validateTransition,
  withVotes,
  type Group,
  type Transition,
} from '../src/index.ts'
import { Network } from './support/network.ts'
import { newToken } from './support/tokens.ts'

const { sig } = predicates
const net = new Network()
const group: Group = await net.group(['a'], 1)
const [owner, other] = [generateSigner(), generateSigner()]

async function finalMint(): Promise<Transition> {
  const t = await newToken({ group, owner })
  return net.directory(group.members[0]!.url).validate({ transition: t, previous: [] })
}

const rejects = (promise: Promise<unknown>, code: string) =>
  expect(promise).rejects.toSatisfy((e) => e instanceof ProtocolError && e.code === code)

describe('lineage and authorization', () => {
  it('requires the issuer to start a token in the recording group', async () => {
    const t = await newToken({ group, owner, issuer: owner })
    await validateTransition(t, [], 'authorized', net.now)
    const unsigned = { ...t, evidence: { signatures: [], preimages: [], proofs: [] } }
    await rejects(validateTransition(unsigned, [], 'authorized', net.now), 'NOT_AUTHORIZED')
    const elsewhere = await net.group(['b'], 1)
    const moved = { ...t, body: { ...t.body, group: elsewhere } }
    await rejects(validateTransition(moved, [], 'authorized', net.now), 'NOT_AUTHORIZED')
  })

  it('continues a token only from its spent output, one step at a time', async () => {
    const minted = await finalMint()
    const [output] = minted.body.outputs
    const skip = { ...continueOutput(output!), sequence: 2 }
    const t = composeTransition({ group, inputs: [spendOf(output!)], outputs: [skip] })
    await rejects(
      validateTransition(await signTransition(t, [owner]), [minted], 'authorized', net.now),
      'INVALID_FORMAT',
    )

    const twice = composeTransition({
      group,
      inputs: [spendOf(output!)],
      outputs: [continueOutput(output!), continueOutput(output!, { data: 1 })],
    })
    await rejects(
      validateTransition(await signTransition(twice, [owner]), [minted], 'authorized', net.now),
      'INVALID_FORMAT',
    )
  })

  it('needs the lock of each spent output', async () => {
    const minted = await finalMint()
    const t = composeTransition({ group, inputs: [spendOf(minted.body.outputs[0]!)], outputs: [] })
    await rejects(
      validateTransition(await signTransition(t, [other]), [minted], 'authorized', net.now),
      'NOT_AUTHORIZED',
    )
    await validateTransition(await signTransition(t, [owner]), [minted], 'authorized', net.now)
  })

  it('enforces keep, groups and accept on continuations', async () => {
    const rules = composeRules({
      profile: 'test/1',
      issuer: sig(owner.key),
      covenant: [{ keep: ['data'] }, { groups: group.members.map((m) => m.key) }, { accept: true }],
      group,
    })
    const minted = withVotes(
      composeTransition({
        group,
        outputs: [startOutput(rules, { lock: sig(owner.key), data: 'deed' })],
      }),
      [],
    )
    const signedMint = await net.directory(group.members[0]!.url).validate({
      transition: await signTransition(minted, [owner]),
      previous: [],
    })
    const output = signedMint.body.outputs[0]!
    const spend = (changes: Parameters<typeof continueOutput>[1], g = group) =>
      composeTransition({
        group,
        inputs: [spendOf(output)],
        outputs: [continueOutput(output, { ...changes, group: g })],
      })

    await rejects(
      validateTransition(
        await signTransition(spend({ lock: sig(other.key), data: 'x' }), [owner, other]),
        [signedMint],
        'authorized',
        net.now,
      ),
      'NOT_AUTHORIZED',
    )
    await rejects(
      validateTransition(
        await signTransition(spend({ lock: sig(other.key) }), [owner]),
        [signedMint],
        'authorized',
        net.now,
      ),
      'NOT_AUTHORIZED',
    )
    const foreign = await net.group(['c'], 1)
    await rejects(
      validateTransition(
        await signTransition(spend({}, foreign), [owner]),
        [signedMint],
        'entry',
        net.now,
      ),
      'NOT_AUTHORIZED',
    )
    await validateTransition(
      await signTransition(spend({ lock: sig(other.key) }), [owner, other]),
      [signedMint],
      'authorized',
      net.now,
    )
  })

  it('expires after valid_until, except once attested', async () => {
    const minted = await finalMint()
    const t = composeTransition({
      group,
      inputs: [spendOf(minted.body.outputs[0]!)],
      outputs: [continueOutput(minted.body.outputs[0]!)],
      validUntil: new Date(net.now.getTime() + 1000),
    })
    const signed = await signTransition(t, [owner])
    await validateTransition(signed, [minted], 'authorized', net.now)
    await rejects(
      validateTransition(signed, [minted], 'authorized', new Date(net.now.getTime() + 1000)),
      'EXPIRED',
    )
  })

  it('never lets one party overwrite the signature of another', async () => {
    const minted = await finalMint()
    const t = composeTransition({ group, inputs: [spendOf(minted.body.outputs[0]!)] })
    const signed = await signTransition(t, [owner])
    const forged = {
      ...t,
      evidence: {
        ...t.evidence,
        signatures: [
          {
            ...signed.evidence.signatures[0]!,
            signature: signed.evidence.signatures[0]!.signature.split('').reverse().join(''),
          },
        ],
      },
    }
    for (const merged of [mergeEvidence(signed, forged), mergeEvidence(forged, signed)]) {
      await validateTransition(merged, [minted], 'authorized', net.now)
    }
  })
})
