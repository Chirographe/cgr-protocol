import { describe, expect, it } from 'vitest'
import {
  commit,
  composeRules,
  composeTransition,
  generateSigner,
  generateWallet,
  holdsAnyKey,
  openMessage,
  p256,
  payTo,
  predicates,
  scanOwners,
  sealMessage,
  signTransition,
  signersFor,
  softwareSigner,
  startOutput,
  walletAddress,
  type Group,
} from '@chirographe/core'
import { people } from '../../core/test/support/tokens.ts'
import { directory, refusal, serve } from './support.ts'

const { sig } = predicates
const { alice } = people('alice')
const RELAY = 'https://relay.test'
const OVERSIZED = 300 * 1024

const relayMessage = (scan: string) => ({ ephemeral: scan, ciphertext: 'AAAA' })

/** Pays a new token to a stealth address. */
async function payToWallet(group: Group, wallet = generateWallet(p256)) {
  const address = walletAddress(wallet, RELAY)
  const { locks, ephemeral } = payTo([address])
  const rules = composeRules({ profile: 'test/1', issuer: sig(alice!.key), group })
  const output = startOutput(rules, { lock: locks[0]!, ...(ephemeral ? { ephemeral } : {}) })
  const transition = await signTransition(composeTransition({ group, outputs: [output] }), [alice!])
  return { wallet, address, transition: await commit(directory, transition, []) }
}

describe('relay and sessions over HTTP', () => {
  it('delivers a message to the holder of the scan key only', async () => {
    const { client } = await serve()
    const holder = generateSigner()
    const scan = holder.key
    const { id } = await client.deposit(scan, relayMessage(scan))

    await expect(client.messages(scan, 'forged')).rejects.toEqual(refusal('UNAUTHENTICATED', 401))
    const stranger = await client.authenticate(generateSigner())
    await expect(client.messages(scan, stranger)).rejects.toEqual(refusal('UNAUTHENTICATED', 401))

    const session = await client.authenticate(holder)
    expect(await client.messages(scan, session)).toMatchObject([
      { id, content: relayMessage(scan) },
    ])
    await expect(client.deleteMessage(scan, id, stranger)).rejects.toEqual(
      refusal('UNAUTHENTICATED', 401),
    )
    await client.deleteMessage(scan, id, session)
    expect(await client.messages(scan, session)).toEqual([])
  })

  it('carries a sealed request that only the recipient opens', async () => {
    const { client, group } = await serve()
    const { wallet, address, transition } = await payToWallet(group)
    const request = { from: address, transition, previous: [] }
    await client.deposit(address.scan, sealMessage(address.scan, request))

    const session = await client.authenticate(softwareSigner(wallet.scan, wallet.algorithm))
    const [message] = await client.messages(address.scan, session)
    expect(openMessage(wallet, message!.content)).toEqual(request)
  })

  it('refuses clear text and oversized messages', async () => {
    const { address, client } = await serve()
    const scan = generateSigner().key
    const post = (body: unknown) =>
      fetch(`${address}/mailbox/${encodeURIComponent(scan)}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      })
    expect((await post({ clear: 'text' })).status).toBe(400)
    expect((await post({ ephemeral: scan, ciphertext: 'A'.repeat(OVERSIZED) })).status).toBe(400)
    await expect(client.deposit(scan, relayMessage(scan))).resolves.toEqual({ id: 1 })
  })

  it('limits deposits and challenges per client', async () => {
    const { client } = await serve({ requestsPerMinute: 2 })
    const scan = generateSigner().key
    await client.deposit(scan, relayMessage(scan))
    await client.deposit(scan, relayMessage(scan))
    await expect(client.deposit(scan, relayMessage(scan))).rejects.toEqual(
      refusal('TOO_MANY_REQUESTS', 429),
    )
    await expect(client.authenticate(generateSigner())).rejects.toEqual(
      refusal('TOO_MANY_REQUESTS', 429),
    )
  })
})

describe('wallet recovery over HTTP', () => {
  it('finds the heads of a wallet from its keys, and shows them to their holder only', async () => {
    const { client, group } = await serve()
    const { wallet, transition } = await payToWallet(group)
    await payToWallet(group)

    const owners = await client.owners(1, 500)
    expect(owners).toHaveLength(2)
    const found = await scanOwners(client, (keys, ephemeral) =>
      holdsAnyKey(wallet, keys, ephemeral),
    )
    expect(found).toHaveLength(1)
    const { keys, ephemeral } = found[0]!
    const signer = signersFor(wallet, keys, ephemeral)[0]!

    await expect(client.outputsOf(signer.key, 'forged')).rejects.toEqual(
      refusal('UNAUTHENTICATED', 401),
    )
    const session = await client.authenticate(signer)
    expect(await client.outputsOf(signer.key, session)).toEqual([transition])
    expect(await client.owners(owners[1]!.n, 1)).toEqual([owners[1]])
  })
})
