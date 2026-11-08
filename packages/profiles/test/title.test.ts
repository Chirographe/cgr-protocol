import { describe, expect, it } from 'vitest'
import {
  commit,
  generateSigner,
  predicates,
  signTransition,
  signersFor,
  predicateKeys,
  utf8,
} from '@chirographe/core'
import {
  TITLE,
  describe as describeOutput,
  digestOf,
  expectsTitle,
  issueTitle,
  newSalt,
  titleData,
  transferTitle,
} from '../src/index.ts'
import { Network, addressOf, newWallet } from './support.ts'

describe(TITLE, () => {
  it('is issued by a registry and changes hands with both signatures', async () => {
    const net = new Network()
    const group = await net.group(['a', 'b', 'c', 'd'], 3)
    const registry = generateSigner()
    const [alice, bob] = [newWallet(), newWallet()]
    const data = { label: 'Parcel 42', digest: digestOf(utf8('deed'), newSalt()) }

    const issued = await commit(
      net.directory,
      await signTransition(
        issueTitle({ issuer: predicates.sig(registry.key), group, holder: addressOf(alice), data }),
        [registry],
      ),
      [],
    )
    const title = issued.body.outputs[0]!
    expect(titleData(title)).toEqual(data)
    expect(describeOutput(title)).toEqual({ profile: TITLE, label: 'Parcel 42' })

    const proposal = transferTitle(title, addressOf(bob))
    const keysOf = (output = proposal.body.outputs[0]!) => predicateKeys(output.lock)
    const fromAlice = await signTransition(
      proposal,
      signersFor(alice, predicateKeys(title.lock), title.ephemeral),
    )
    const submission = { transition: fromAlice, previous: [issued] }
    expect(expectsTitle(submission, bob)).toBe(true)
    expect(expectsTitle(submission, alice)).toBe(false)

    await expect(commit(net.directory, fromAlice, [issued])).rejects.toThrow()
    const next = proposal.body.outputs[0]!
    const both = await signTransition(fromAlice, signersFor(bob, keysOf(), next.ephemeral))
    const final = await commit(net.directory, both, [issued])
    expect(titleData(final.body.outputs[0]!)).toEqual(data)
  })
})
