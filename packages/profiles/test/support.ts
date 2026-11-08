import {
  Guardian,
  MemoryGuardianStore,
  generateWallet,
  memoryKeyring,
  p256,
  walletAddress,
  type Directory,
  type Group,
  type Wallet,
} from '@chirographe/core'

/** In-process guardians with a clock under test control. */
export class Network {
  private readonly guardians = new Map<string, Guardian>()
  now = new Date('2026-11-06T12:00:00.000Z')

  async group(names: string[], threshold: number): Promise<Group> {
    const members = []
    for (const name of names) {
      const url = `https://${name}.test`
      const guardian = await Guardian.open({
        name,
        url,
        store: new MemoryGuardianStore(),
        keyring: memoryKeyring(),
        clock: () => this.now,
      })
      this.guardians.set(url, guardian)
      members.push({ key: guardian.key, url })
    }
    return { members, threshold }
  }

  directory: Directory = (url) => {
    const guardian = this.guardians.get(url)
    if (!guardian) throw new Error(`no guardian at ${url}`)
    return guardian
  }

  advance(seconds: number): void {
    this.now = new Date(this.now.getTime() + seconds * 1000)
  }
}

export const RELAY = 'https://relay.test'

export const newWallet = (): Wallet => generateWallet(p256)

export const addressOf = (wallet: Wallet) => walletAddress(wallet, RELAY)
