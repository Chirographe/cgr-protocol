import { afterEach, expect } from 'vitest'
import type { FastifyInstance } from 'fastify'
import {
  Guardian,
  HttpGuardian,
  Mailboxes,
  MemoryGuardianStore,
  MemoryKeyVault,
  MemoryMailboxStore,
  MemoryWitnessStore,
  ProtocolError,
  httpDirectory,
  memoryKeyring,
  type Group,
  type GuardianStorage,
  type Keyring,
  type WitnessStorage,
} from '@chirographe/core'
import { createGuardianServer, type GuardianServerOptions } from '../src/index.ts'

export const START = new Date('2026-11-06T12:00:00.000Z')
export const LOCALHOST = '127.0.0.1'

const apps: FastifyInstance[] = []

/** Closes every server a test started. */
export const track = (app: FastifyInstance): FastifyInstance => {
  apps.push(app)
  return app
}

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()))
})

/** Guardians know each other by public URL. This maps those URLs to local sockets. */
const addresses = new Map<string, string>()

export const directory = httpDirectory({
  fetch: (url, init) => {
    const { origin, pathname, search } = new URL(url)
    return fetch(`${addresses.get(origin)}${pathname}${search}`, init)
  },
})

/** A clock that tests move forward. */
export function testClock() {
  let now = START
  return {
    clock: () => now,
    advance: (seconds: number) => {
      now = new Date(now.getTime() + seconds * 1000)
    },
  }
}

export interface ServeOptions extends Partial<
  Omit<GuardianServerOptions, 'guardian' | 'mailboxes'>
> {
  name?: string
  clock?: () => Date
  store?: MemoryGuardianStore
  keyring?: Keyring
}

/** A guardian on memory storage, served over a real socket. */
export async function serve({ name = 'x', clock, store, keyring, ...options }: ServeOptions = {}) {
  const url = `https://${name}.test`
  const guardian = await Guardian.open({
    name,
    url,
    store: store ?? new MemoryGuardianStore(),
    keyring: keyring ?? memoryKeyring(),
    ...(clock ? { clock } : {}),
  })
  const mailboxes = new Mailboxes(new MemoryMailboxStore(), clock)
  const app = track(await createGuardianServer({ guardian, mailboxes, ...options }))
  const address = await app.listen({ host: LOCALHOST, port: 0 })
  addresses.set(url, address)
  const group: Group = { members: [{ key: guardian.key, url }], threshold: 1 }
  return { app, guardian, address, url, group, client: new HttpGuardian(address) }
}

/** One group made of several servers. */
export const groupOf = (servers: { group: Group }[], threshold: number): Group => ({
  members: servers.flatMap((server) => server.group.members),
  threshold,
})

/** Durable for as long as the test keeps the object: a restart reuses it. */
export const memoryGuardianStorage = (): GuardianStorage => ({
  guardian: new MemoryGuardianStore(),
  mailboxes: new MemoryMailboxStore(),
  vault: new MemoryKeyVault(),
  close: () => Promise.resolve(),
})

export const memoryWitnessStorage = (): WitnessStorage => ({
  witness: new MemoryWitnessStore(),
  vault: new MemoryKeyVault(),
  close: () => Promise.resolve(),
})

/** Matches a protocol refusal by code and HTTP status. */
export const refusal = (code: string, status: number): unknown =>
  expect.objectContaining({ name: ProtocolError.name, code, status })
