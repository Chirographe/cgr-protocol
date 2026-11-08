import { describe, expect, it } from 'vitest'
import {
  addProofs,
  bodyHash,
  claimOf,
  commit,
  composeTransition,
  outputId,
  predicates,
  tokenOf,
  type Group,
  type Output,
  type Transition,
} from '@chirographe/core'
import { commitmentOf, nullifierOf, rootOf, testScheme } from '../../core/test/support/scheme.ts'
import { heldAt, newToken, people } from '../../core/test/support/tokens.ts'
import { directory, groupOf, refusal, serve } from './support.ts'

const { member } = predicates
const { alice } = people('alice')

/** Registered only through the server options, unlike the scheme of `core` tests. */
const scheme = { ...testScheme, id: 'server-test/1' }
const voters = ['v1', 'v2'].map(commitmentOf)

async function ballot(group: Group, election: Output, secret: string, choice: string) {
  const nullifier = nullifierOf(secret, outputId(election))
  const t = composeTransition({ group, inputs: [claimOf(election, nullifier)], data: { choice } })
  const proof = { secret, members: voters, signal: bodyHash(t) }
  return addProofs(t, [{ scheme: scheme.id, nullifier, proof }])
}

describe('claims over HTTP', () => {
  it('accepts one claim per nullifier with a scheme given at startup, and lists them', async () => {
    const servers = await Promise.all(
      ['a', 'b', 'c', 'd'].map((name) => serve({ name, schemes: [scheme] })),
    )
    const group = groupOf(servers, 3)
    const claim = member(rootOf(voters), scheme.id)
    const election = heldAt(
      await commit(directory, await newToken({ group, owner: alice!, claim }), []),
    )
    const vote = (secret: string, choice: string): Promise<Transition> =>
      ballot(group, election.output, secret, choice)

    await commit(directory, await vote('v1', 'yes'), [election.transition])
    await commit(directory, await vote('v2', 'no'), [election.transition])
    await expect(commit(directory, await vote('v1', 'no'), [election.transition])).rejects.toEqual(
      refusal('ALREADY_SPENT', 409),
    )
    await expect(
      commit(directory, await vote('intruder', 'no'), [election.transition]),
    ).rejects.toEqual(refusal('NOT_AUTHORIZED', 400))

    const claims = await servers[1]!.client.claims(outputId(election.output))
    expect(claims.map((c) => c.body.data)).toEqual([{ choice: 'yes' }, { choice: 'no' }])
    const head = await servers[0]!.client.tokenHead(tokenOf(election.output))
    expect(head).toMatchObject({ here: true, output: outputId(election.output) })
  })
})
