import { describe, expect, it } from 'vitest'
import {
  HttpGuardian,
  acceptProposal,
  checkLedger,
  commit,
  composeProposal,
  deriveOwner,
  generateSigner,
  hashOf,
  hashToBytes,
  isKnownKey,
  isSoleOwner,
  owns,
  scanOwners,
  signersFor,
  signersForState,
  validateToken,
  walletAddress,
  type Guardian,
  type GuardianApi,
  type Token,
} from '../src/index.ts'
import { encodeBase64Url } from '../src/encoding/base64url.ts'
import { Network, directAddress, groupOf, guardians, mint, newWallet } from './network.ts'

describe('a server that a wallet logs in to', () => {
  it('cannot turn a login into a signature on a transfer', async () => {
    const net = new Network()
    const [x] = (await guardians(net, ['x'])) as [Guardian]
    const victim = newWallet()
    const token = await mint(net, victim, groupOf([x], 1))

    const thief = newWallet()
    const { keys, threshold } = directAddress(thief)
    const unsigned = await composeProposal(token, {
      signers: [generateSigner()],
      recipient: { owner: { keys, threshold } },
      expiresIn: 3600,
      now: net.now,
    })

    // The rogue server sends the hash of a state that gives the token away, as a challenge.
    let signature = ''
    const rogue = new HttpGuardian('https://rogue.test', {
      fetch: (url, init) => {
        if (url.endsWith('/auth/challenge')) {
          const challenge = encodeBase64Url(hashToBytes(hashOf(unsigned.state)))
          return Promise.resolve(new Response(JSON.stringify({ challenge })))
        }
        ;({ signature } = JSON.parse(init.body as string) as { signature: string })
        return Promise.resolve(new Response(JSON.stringify({ session: 'x' })))
      },
    })
    const [signer] = signersForState(victim, token.state)
    await rogue.authenticate(signer as NonNullable<typeof signer>)
    expect(signature).not.toBe('')

    const forged: Token = {
      ...unsigned,
      signatures: { senders: [{ type: 'raw', key: signer?.key as string, signature }] },
    }
    expect(() => validateToken(forged, { stage: 'proposed', previous: token.state })).toThrow()
    const complete = await acceptProposal(forged, signersFor(thief, { keys, threshold }))
    await expect(commit(net.directory, complete, token)).rejects.toMatchObject({
      code: 'INVALID_SIGNATURE',
    })
  })
})

describe('a recipient', () => {
  it('does not take a token that the sender still co-owns for its own', () => {
    const bob = newWallet()
    const sender = newWallet()
    const shared = {
      keys: [...directAddress(bob).keys, ...directAddress(sender).keys],
      threshold: 1,
    }
    expect(owns(bob, shared)).toBe(true)
    expect(isSoleOwner(bob, shared)).toBe(false)
  })

  it('does not accept a lower threshold than its own', () => {
    const bob = newWallet(2, 2)
    const { keys } = directAddress(bob)
    expect(isSoleOwner(bob, { keys, threshold: 2 })).toBe(true)
    expect(isSoleOwner(bob, { keys, threshold: 1 })).toBe(false)
  })

  it('recognizes what is really its own, stealth included', () => {
    const bob = newWallet()
    const { owner, ephemeral } = deriveOwner(walletAddress(bob, 'https://relay.test', true))
    expect(isSoleOwner(bob, owner, ephemeral)).toBe(true)
    const { keys, threshold } = directAddress(bob)
    expect(isSoleOwner(bob, { keys, threshold })).toBe(true)
  })
})

describe('a wallet', () => {
  const stranger = () => newWallet()

  it('survives a malformed ephemeral in the list of owners', async () => {
    const wallet = stranger()
    const owner = { keys: directAddress(wallet).keys, threshold: 1 }
    const guardian = {
      owners: () => Promise.resolve([{ n: 1, ephemeral: 'p256:AAAA', owner }]),
    } as unknown as GuardianApi
    await expect(scanOwners(guardian, wallet)).resolves.toEqual([])
  })

  it('treats any explicit lock of a head as a lock', async () => {
    const net = new Network()
    const [x] = (await guardians(net, ['x'])) as [Guardian]
    const head = await x.head()
    const lying = { head: () => Promise.resolve({ ...head, locked: false }) } as GuardianApi
    expect(await checkLedger(lying, x.key, null)).toMatchObject({ ok: false })
  })
})

describe('keys', () => {
  it('reject what is not a point on the curve', () => {
    expect(isKnownKey('p256:AAAA')).toBe(false)
    const valid = generateSigner().key
    expect(isKnownKey(valid)).toBe(true)
    const flipped = `${valid.slice(0, 40)}${valid[40] === 'A' ? 'B' : 'A'}${valid.slice(41)}`
    expect(isKnownKey(flipped)).toBe(false)
  })

  it('have one spelling only', () => {
    const valid = generateSigner().key
    const last = valid.at(-1) as string
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'
    // A last character only carries part of its bits: the next ones decode to the same bytes.
    const alias = `${valid.slice(0, -1)}${alphabet[alphabet.indexOf(last) + 1] ?? 'A'}`
    expect(isKnownKey(alias)).toBe(false)
  })
})
