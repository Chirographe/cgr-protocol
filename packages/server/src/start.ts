import type { FastifyInstance } from 'fastify'
import {
  Guardian,
  Mailboxes,
  Witness,
  httpDirectory,
  sealedKeyring,
  type Directory,
  type GuardianStorage,
  type WitnessStorage,
} from '@chirographe/core'
import type { GuardianServerConfig, WitnessServerConfig } from './config.ts'
import { createGuardianServer } from './guardian.ts'
import { createWitnessServer } from './witness.ts'

async function openGuardian(config: GuardianServerConfig, storage: GuardianStorage) {
  const { name, url, policy } = config
  const keyring = await sealedKeyring(storage.vault, config.password)
  return Guardian.open({ name, url, policy, keyring, store: storage.guardian })
}

/** Runs a guardian on any storage. The server closes the storage when it stops. */
export async function startGuardian(
  config: GuardianServerConfig,
  storage: GuardianStorage,
): Promise<{ app: FastifyInstance; guardian: Guardian }> {
  const guardian = await openGuardian(config, storage)
  const mailboxes = new Mailboxes(storage.mailboxes)
  const app = await createGuardianServer({ ...config, guardian, mailboxes })
  app.addHook('onClose', () => storage.close())
  await app.listen({ host: config.host, port: config.port })
  console.log(`${config.name} on ${config.url}, key ${guardian.key}`)
  if (guardian.locked) console.error('LEDGER_LOCKED: integrity check failed, not signing')
  return { app, guardian }
}

/** Rotates the guardian key. Run it with the server stopped. */
export async function rotateGuardianKey(
  config: GuardianServerConfig,
  storage: GuardianStorage,
): Promise<void> {
  const guardian = await openGuardian(config, storage)
  const previous = guardian.key
  await guardian.rotate()
  console.log(`rotated ${previous} to ${guardian.key}`)
  await storage.close()
}

/** Runs a witness on any storage, and observes its guardians until it stops. */
export async function startWitness(
  config: WitnessServerConfig,
  storage: WitnessStorage,
  directory: Directory = httpDirectory(),
): Promise<{ app: FastifyInstance; witness: Witness }> {
  const keyring = await sealedKeyring(storage.vault, config.password)
  const witness = new Witness(keyring.current(), directory, storage.witness)
  const app = await createWitnessServer({ ...config, witness })

  let timer: NodeJS.Timeout | undefined
  let round: Promise<void> = Promise.resolve()
  const observe = async () => {
    // A guardian that is not up yet is followed on a later round.
    await Promise.allSettled(config.guardians.map((url) => witness.follow(url)))
    await witness.observe()
  }
  const loop = () => {
    round = observe()
      .catch((error: unknown) => console.error(error))
      .finally(() => {
        timer = setTimeout(loop, config.intervalSeconds * 1000)
      })
  }
  app.addHook('onClose', async () => {
    clearTimeout(timer)
    await round
    clearTimeout(timer)
    await storage.close()
  })

  await app.listen({ host: config.host, port: config.port })
  console.log(`${config.name} on port ${config.port}, key ${witness.key}`)
  loop()
  return { app, witness }
}

/** Stops cleanly on the signals a process manager sends. */
export function closeOnSignal(app: FastifyInstance): void {
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.once(signal, () => void app.close())
  }
}
