import { afterAll } from 'vitest'
import type { FastifyInstance } from 'fastify'
import {
  Guardian,
  Mailboxes,
  MemoryGuardianStore,
  MemoryMailboxStore,
  httpDirectory,
  memoryKeyring,
  type SignatureAlgorithm,
} from '@chirographe/core'
import { Network as MemoryNetwork } from '../../core/test/support/network.ts'
import { createGuardianServer } from '../src/index.ts'
import { LOCALHOST } from './support.ts'

export { groupOf, type Node } from '../../core/test/support/network.ts'

const running: FastifyInstance[] = []

// Some scenarios build their network once per file.
afterAll(async () => {
  await Promise.all(running.splice(0).map((app) => app.close()))
})

/** The network of `core` tests, with every client call going through a socket and HTTP. */
export class Network extends MemoryNetwork {
  private readonly addresses = new Map<string, string>()

  override directory = httpDirectory({
    fetch: (target, init) => {
      const { origin, pathname, search } = new URL(target)
      const address = this.addresses.get(origin)
      if (!address || this.down.has(origin)) return Promise.reject(new Error('unreachable'))
      return fetch(`${address}${pathname}${search}`, init)
    },
  })

  /** Serves the guardian the scenario holds at this URL, even when it swaps it. */
  private served(url: string): Guardian {
    return new Proxy({} as Guardian, {
      get: (_target, property) => {
        const { guardian } = this.nodes.get(url)!
        const value: unknown = Reflect.get(guardian, property)
        return typeof value === 'function' ? (value as () => unknown).bind(guardian) : value
      },
    })
  }

  override async add(name: string, algorithm?: SignatureAlgorithm): Promise<Guardian> {
    const url = `https://${name}.test`
    const store = new MemoryGuardianStore()
    const keyring = memoryKeyring(algorithm)
    const guardian = await Guardian.open({ name, url, store, keyring, clock: this.clock })
    this.nodes.set(url, { guardian, store })
    const mailboxes = new Mailboxes(new MemoryMailboxStore(), this.clock)
    const app = await createGuardianServer({ guardian: this.served(url), mailboxes })
    running.push(app)
    this.addresses.set(url, await app.listen({ host: LOCALHOST, port: 0 }))
    return guardian
  }
}
