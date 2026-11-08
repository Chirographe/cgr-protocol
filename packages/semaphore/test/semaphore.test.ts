import { describe, expect, it } from 'vitest'
import { hashOf, schemeOf } from '@chirographe/core'
import {
  SEMAPHORE_SCHEME,
  commitmentOf,
  createIdentity,
  nullifierOf,
  proveMembership,
  registerSemaphore,
  rootOf,
  semaphoreScheme,
} from '../src/index.ts'

const PROVING_TIMEOUT = 120_000

describe('semaphore/4', () => {
  it(
    'proves and verifies membership bound to a scope and a message',
    async () => {
      const voters = [createIdentity(), createIdentity(), createIdentity()]
      const commitments = voters.map(commitmentOf)
      const root = rootOf(commitments)
      const scope = hashOf('election output')
      const message = hashOf('ballot body')
      const identity = voters[1]!

      const evidence = await proveMembership({ identity, commitments, scope, message })
      expect(evidence.scheme).toBe(SEMAPHORE_SCHEME)
      expect(evidence.nullifier).toBe(nullifierOf(identity, scope))

      const claim = { root, nullifier: evidence.nullifier, scope, message, proof: evidence.proof }
      expect(await semaphoreScheme.verify(claim)).toBe(true)
      expect(await semaphoreScheme.verify({ ...claim, message: hashOf('other body') })).toBe(false)
      expect(await semaphoreScheme.verify({ ...claim, scope: hashOf('other output') })).toBe(false)
      expect(
        await semaphoreScheme.verify({ ...claim, root: rootOf(commitments.slice(0, 2)) }),
      ).toBe(false)
      expect(await semaphoreScheme.verify({ ...claim, proof: { depth: 2 } })).toBe(false)
    },
    PROVING_TIMEOUT,
  )

  it('gives one nullifier per identity and scope', () => {
    const identity = createIdentity()
    const scope = hashOf('a')
    expect(nullifierOf(identity, scope)).toBe(nullifierOf(identity, scope))
    expect(nullifierOf(identity, hashOf('b'))).not.toBe(nullifierOf(identity, scope))
    expect(nullifierOf(createIdentity(), scope)).not.toBe(nullifierOf(identity, scope))
  })

  it('registers itself as a membership scheme', () => {
    registerSemaphore()
    expect(schemeOf(SEMAPHORE_SCHEME)).toBe(semaphoreScheme)
  })
})
