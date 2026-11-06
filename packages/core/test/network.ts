import {
  Guardian,
  MemoryGuardianStore,
  generateWallet,
  memoryKeyring,
  p256,
  walletAddress,
  type Directory,
  type Group,
  type SignatureAlgorithm,
  type Token,
  type Wallet,
} from '../src/index.ts'
import { composeToken, signersForState, soleOwner } from '../src/index.ts'
import { createToken } from '../src/index.ts'

export interface Node {
  guardian: Guardian
  store: MemoryGuardianStore
}

/** Guardians in one process, with a clock and failures under test control. */
export class Network {
  readonly nodes = new Map<string, Node>()
  readonly down = new Set<string>()
  now = new Date('2026-11-06T12:00:00.000Z')
  readonly clock = () => this.now

  async add(name: string, algorithm?: SignatureAlgorithm): Promise<Guardian> {
    const url = `https://${name}.test`
    const store = new MemoryGuardianStore()
    const keyring = memoryKeyring(algorithm)
    const guardian = await Guardian.open({ name: name, url, store, keyring, clock: this.clock })
    this.nodes.set(url, { guardian, store })
    return guardian
  }

  directory: Directory = (url) => {
    const node = this.nodes.get(url)
    if (!node) throw new Error(`no guardian at ${url}`)
    if (!this.down.has(url)) return node.guardian
    const failing = () => Promise.reject(new Error('unreachable'))
    return new Proxy(node.guardian, { get: () => failing })
  }

  advance(seconds: number): void {
    this.now = new Date(this.now.getTime() + seconds * 1000)
  }
}

export const groupOf = (guardians: Guardian[], threshold: number): Group => ({
  members: guardians.map((g) => ({ key: g.key, url: g.url })),
  threshold,
})

export async function guardians(net: Network, names: string[]): Promise<Guardian[]> {
  return Promise.all(names.map((name) => net.add(name)))
}

export const newWallet = (keys = 1, threshold = 1): Wallet => generateWallet(p256, keys, threshold)

export const directAddress = (wallet: Wallet) => walletAddress(wallet, 'https://relay.test', false)
export const stealthAddress = (wallet: Wallet) => walletAddress(wallet, 'https://relay.test', true)

/** A token owned by a wallet with a plain key. */
export async function mint(
  net: Network,
  wallet: Wallet,
  guardian: Group,
  extra: { recovery?: Token['rules']['recovery']; allowed_guardians?: string[] } = {},
): Promise<Token> {
  const address = directAddress(wallet)
  const owner = { keys: address.keys, threshold: address.threshold }
  const state = { owner: owner } as Token['state']
  const token = await composeToken({
    owner,
    signers: signersForState(wallet, state),
    subject: 'Parcel 42',
    guardian,
    now: net.now,
    ...extra,
  })
  return createToken(net.directory, token)
}

export { soleOwner }
