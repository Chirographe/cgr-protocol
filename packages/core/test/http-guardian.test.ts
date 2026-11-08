import { describe, expect, it } from 'vitest'
import {
  HttpGuardian,
  ProtocolError,
  checkLedger,
  checkVoteLine,
  commit,
  generateSigner,
  hashOf,
  httpDirectory,
  outputId,
  predicates,
  tokenOf,
  type Directory,
} from '../src/index.ts'
import { fakeFetch, type Host } from './support/fake-http.ts'
import { Network } from './support/network.ts'
import { heldAt, move, newToken, people } from './support/tokens.ts'

const { sig } = predicates
const { alice, bob } = people('alice', 'bob')

/** A network whose calls all go through HTTP clients and a fake `fetch`. */
async function overHttp(names: string[], threshold: number) {
  const net = new Network()
  const group = await net.group(names, threshold)
  const hosts = new Map<string, Host>()
  for (const [url, node] of net.nodes) hosts.set(url, { guardian: node.guardian })
  const fetch = fakeFetch(hosts)
  const directory: Directory = httpDirectory({ fetch })
  const client = (name: string) => new HttpGuardian(`https://${name}.test/`, { fetch })
  return { net, group, directory, client }
}

describe('HttpGuardian', () => {
  it('commits and reads back a token over HTTP', async () => {
    const { group, directory, client } = await overHttp(['a', 'b', 'c', 'd'], 3)
    const minted = heldAt(await commit(directory, await newToken({ group, owner: alice! }), []))
    const moved = await commit(directory, await move(minted, [alice!], { lock: sig(bob!.key) }), [
      minted.transition,
    ])
    const a = client('a')
    expect((await a.info()).url).toBe('https://a.test')
    expect(await a.tokenHead(tokenOf(minted.output))).toMatchObject({ here: true, sequence: 1 })
    expect((await a.transition(hashOf(moved.body))).body).toEqual(moved.body)
    expect(await a.lines(1, 10)).toHaveLength(2)
    expect(await a.claims(outputId(minted.output))).toEqual([])
    expect(await a.notices()).toEqual([])
    expect(await a.owners(1, 10)).toEqual([{ n: 2, keys: [bob!.key] }])

    const head = await a.head()
    expect((await checkLedger(a, (await a.info()).key, null)).ok).toBe(true)
    const vote = moved.guardians!.find((v) => v.key === group.members[0]!.key)!
    expect(await checkVoteLine(a, hashOf(moved.body), vote, head)).toBe(true)
    expect(await a.inclusionProof(1, 2)).toHaveLength(1)
    expect(await a.consistencyProof(1, 2)).toHaveLength(1)
  })

  it('carries protocol errors with their code and details', async () => {
    const { net, group, directory, client } = await overHttp(['a'], 1)
    const to = await net.group(['x'], 1)
    const minted = heldAt(await commit(directory, await newToken({ group, owner: alice! }), []))
    const a = client('a')
    const unknown = a.tokenHead(hashOf('unknown'))
    await expect(unknown).rejects.toBeInstanceOf(ProtocolError)
    await expect(unknown).rejects.toMatchObject({ code: 'UNKNOWN', status: 404 })

    await net.node('a').guardian.certify({ transition: minted.transition, previous: [] })
    const leaving = await move(minted, [alice!], { group: to })
    await expect(
      a.enter({ transition: leaving, previous: [minted.transition] }),
    ).rejects.toMatchObject({
      code: 'INVALID_FORMAT',
    })
    await expect(
      a.validate({ transition: leaving, previous: [minted.transition] }),
    ).rejects.toMatchObject({
      code: 'NOT_AUTHORIZED',
    })
  })

  it('reports TOKEN_MOVED with where the token went', async () => {
    const net = new Network()
    const group = await net.group(['a'], 1)
    const to = await net.group(['x'], 1)
    const hosts = new Map<string, Host>()
    for (const [url, node] of net.nodes) hosts.set(url, { guardian: node.guardian })
    const fetch = fakeFetch(hosts)
    const directory = httpDirectory({ fetch })
    const minted = heldAt(await commit(directory, await newToken({ group, owner: alice! }), []))
    const moved = await commit(directory, await move(minted, [alice!], { group: to }), [
      minted.transition,
    ])
    const back = await move(heldAt(moved), [alice!], {}, group)
    const refused = new HttpGuardian('https://a.test', { fetch }).validate({
      transition: back,
      previous: [moved],
    })
    await expect(refused).rejects.toMatchObject({ code: 'TOKEN_MOVED', details: { moved_to: to } })
  })

  it('opens sessions, and serves mailboxes and outputs to key holders only', async () => {
    const { group, directory, client } = await overHttp(['a'], 1)
    const minted = heldAt(await commit(directory, await newToken({ group, owner: alice! }), []))
    const a = client('a')
    const scan = generateSigner()
    const message = { ephemeral: scan.key, ciphertext: 'AAAA' }
    const { id } = await a.deposit(scan.key, message)

    await expect(a.messages(scan.key, 'forged')).rejects.toMatchObject({ code: 'UNAUTHENTICATED' })
    const session = await a.authenticate(scan)
    expect(await a.messages(scan.key, session)).toMatchObject([{ id, content: message }])
    await a.deleteMessage(scan.key, id, session)
    expect(await a.messages(scan.key, session)).toEqual([])

    const owner = await a.authenticate(alice!)
    expect(await a.outputsOf(alice!.key, owner)).toEqual([minted.transition])
    await expect(a.outputsOf(alice!.key, session)).rejects.toMatchObject({ status: 401 })
  })
})
