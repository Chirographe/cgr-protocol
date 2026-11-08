import { describe, expect, it } from 'vitest'
import {
  PredicateSchema,
  evidenceContext,
  fitsLimits,
  generateSigner,
  hashOf,
  holds,
  predicateKeys,
  predicates,
  type Evidence,
  type Predicate,
} from '../src/index.ts'
import { evidenceMessage } from '../src/signing/messages.ts'
import { encodeBase64Url } from '../src/encoding/base64url.ts'
import { TEST_SCHEME, commitmentOf, nullifierOf, rootOf } from './support/scheme.ts'

const { sig, threshold, all, any, after, before, hashLock, member, keys } = predicates

const body = hashOf('body')
const [a, b, c] = [generateSigner(), generateSigner(), generateSigner()]

async function evidence(signers = [a], extra: Partial<Evidence> = {}): Promise<Evidence> {
  const signatures = await Promise.all(
    signers.map(async (s) => ({
      type: 'raw' as const,
      key: s.key,
      signature: await s.sign(evidenceMessage(body)),
    })),
  )
  return { signatures, preimages: [], proofs: [], ...extra }
}

const at = new Date('2026-11-06T12:00:00.000Z')
const check = async (p: Predicate, e: Evidence, when: Date | 'attested' = at, claim = null) =>
  holds(p, evidenceContext(body, e, when), claim)

describe('predicates', () => {
  it('checks signatures over H(body) only', async () => {
    expect(await check(sig(a.key), await evidence([a]))).toBe(true)
    expect(await check(sig(b.key), await evidence([a]))).toBe(false)
    const forged = {
      type: 'raw' as const,
      key: b.key,
      signature: encodeBase64Url(new Uint8Array(64)),
    }
    expect(await check(sig(b.key), await evidence([], { signatures: [forged] }))).toBe(false)
  })

  it('counts a threshold of parts', async () => {
    const e = await evidence([a, c])
    expect(await check(keys(2, [a.key, b.key, c.key]), e)).toBe(true)
    expect(await check(keys(3, [a.key, b.key, c.key]), e)).toBe(false)
    expect(await check(any(sig(b.key), sig(c.key)), e)).toBe(true)
    expect(await check(all(sig(a.key), sig(b.key)), e)).toBe(false)
  })

  it('compares dates with the evaluation date, and trusts attested ones', async () => {
    const e = await evidence()
    expect(await check(after(at), e)).toBe(true)
    expect(await check(after(new Date(at.getTime() + 1)), e)).toBe(false)
    expect(await check(before(at), e)).toBe(false)
    expect(await check(before(new Date(at.getTime() + 1)), e)).toBe(true)
    expect(await check(after(new Date('2999-01-01')), e, 'attested')).toBe(true)
  })

  it('opens hash locks with a revealed preimage', async () => {
    const secret = { s: 'open sesame' }
    expect(await check(hashLock(hashOf(secret)), await evidence([], { preimages: [secret] }))).toBe(
      true,
    )
    expect(await check(hashLock(hashOf(secret)), await evidence([], { preimages: ['no'] }))).toBe(
      false,
    )
  })

  it('verifies membership only for a claim, with a registered scheme', async () => {
    const members = [commitmentOf('alice'), commitmentOf('bob')]
    const root = rootOf(members)
    const scope = hashOf('election')
    const nullifier = nullifierOf('alice', scope)
    const proof = {
      scheme: TEST_SCHEME,
      nullifier,
      proof: { secret: 'alice', members, signal: body },
    }
    const e = await evidence([], { proofs: [proof] })
    expect(await check(member(root, TEST_SCHEME), e, at, { nullifier, scope } as never)).toBe(true)
    expect(await check(member(root, TEST_SCHEME), e)).toBe(false)
    expect(await check(member(root, 'unknown/1'), e, at, { nullifier, scope } as never)).toBe(false)
    const other = { nullifier: nullifierOf('alice', hashOf('other')), scope: hashOf('other') }
    expect(await check(member(root, TEST_SCHEME), e, at, other as never)).toBe(false)
  })

  it('enforces depth, size and distinct keys', () => {
    const deep = (n: number): Predicate => (n === 0 ? sig(a.key) : threshold(1, [deep(n - 1)]))
    expect(fitsLimits(deep(3))).toBe(true)
    expect(fitsLimits(deep(4))).toBe(false)
    expect(fitsLimits(threshold(1, [sig(a.key), sig(a.key)]))).toBe(false)
    const many = Array.from({ length: 33 }, () => sig(generateSigner().key))
    expect(fitsLimits(threshold(1, many))).toBe(false)
    expect(PredicateSchema.safeParse(threshold(1, [sig(a.key), sig(a.key)])).success).toBe(false)
    expect(PredicateSchema.safeParse({ threshold: 3, of: [sig(a.key)] }).success).toBe(false)
    expect(predicateKeys(any(sig(a.key), all(sig(b.key), after(at))))).toEqual([a.key, b.key])
  })
})
