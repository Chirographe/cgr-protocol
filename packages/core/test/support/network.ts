import {
  Guardian,
  MemoryGuardianStore,
  memoryKeyring,
  type Directory,
  type Group,
  type SignatureAlgorithm,
} from '../../src/index.ts'

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
    const guardian = await Guardian.open({ name, url, store, keyring, clock: this.clock })
    this.nodes.set(url, { guardian, store })
    return guardian
  }

  async group(names: string[], threshold: number): Promise<Group> {
    const guardians = await Promise.all(names.map((name) => this.add(name)))
    return groupOf(guardians, threshold)
  }

  node(name: string): Node {
    const node = this.nodes.get(`https://${name}.test`)
    if (!node) throw new Error(`no guardian ${name}`)
    return node
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
