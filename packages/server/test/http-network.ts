import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach } from 'vitest'
import type { FastifyInstance } from 'fastify'
import {
  Guardian,
  Mailboxes,
  httpDirectory,
  memoryKeyring,
  type GuardianStorage,
  type SignatureAlgorithm,
} from '@chirographe/core'
import { openGuardianStorage } from '@chirographe/storage-sqlite'
import { createGuardianServer } from '../src/index.ts'
import { Network as MemoryNetwork } from '../../core/test/network.ts'

export {
  directAddress,
  groupOf,
  guardians,
  mint,
  newWallet,
  soleOwner,
  stealthAddress,
} from '../../core/test/network.ts'

interface Running {
  app: FastifyInstance
  storage: GuardianStorage
  folder: string
}

const running: Running[] = []

afterEach(async () => {
  for (const { app, storage, folder } of running.splice(0)) {
    await app.close()
    await storage.close()
    rmSync(folder, { recursive: true, force: true })
  }
})

/** Same network as in `core`, with every call going through a socket, HTTP and SQLite. */
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

  override async add(name: string, algorithm?: SignatureAlgorithm): Promise<Guardian> {
    const url = `https://${name}.test`
    const folder = mkdtempSync(join(tmpdir(), 'chirographe-'))
    const storage = openGuardianStorage(folder)
    const guardian = await Guardian.open({
      name,
      url,
      store: storage.guardian,
      keyring: memoryKeyring(algorithm),
      clock: this.clock,
    })
    const mailboxes = new Mailboxes(storage.mailboxes, this.clock)
    const app = await createGuardianServer({ guardian, mailboxes })
    this.addresses.set(url, await app.listen({ host: '127.0.0.1', port: 0 }))
    running.push({ app, storage, folder })
    return guardian
  }
}
