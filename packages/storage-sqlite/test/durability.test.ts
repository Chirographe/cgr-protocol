import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'
import {
  Guardian,
  MemoryKeyVault,
  checkLedger,
  generateSigner,
  hashOf,
  memoryKeyring,
  sealedKeyring,
  tokenOf,
  type GuardianStore,
  type Keyring,
  type Transition,
} from '@chirographe/core'
import { newToken } from '../../core/test/support/tokens.ts'
import { openGuardianStorage, openWitnessStorage } from '../src/index.ts'
import { guardianStorage, newFolder, witnessStorage } from './support.ts'

const URL = 'https://x.test'
const PASSWORD = 'secret'
const SEAL = { cost: 4 }
const DATE = '2026-11-06T12:00:00.000Z'
const owner = generateSigner()

const open = (store: GuardianStore, keyring: Keyring) =>
  Guardian.open({ name: 'x', url: URL, store, keyring })

async function mint(guardian: Guardian): Promise<Transition> {
  const group = { members: [{ key: guardian.key, url: guardian.url }], threshold: 1 }
  return guardian.validate({ transition: await newToken({ group, owner }), previous: [] })
}

describe('sqlite durability', () => {
  it('finds its ledger, head, index and key after a restart', async () => {
    const folder = newFolder()
    const first = openGuardianStorage(folder)
    const guardian = await open(first.guardian, await sealedKeyring(first.vault, PASSWORD, SEAL))
    const minted = await mint(guardian)
    const head = await guardian.head()
    await first.close()

    const second = guardianStorage(folder)
    const restarted = await open(second.guardian, await sealedKeyring(second.vault, PASSWORD, SEAL))
    expect(restarted.key).toBe(guardian.key)
    expect(restarted.locked).toBe(false)
    expect(await restarted.head()).toEqual(head)
    const token = tokenOf(minted.body.outputs[0]!)
    expect(await restarted.tokenHead(token)).toMatchObject({ here: true, sequence: 0 })
    expect(await restarted.transition(hashOf(minted.body))).toEqual(minted)
  })

  it('recovers from a crash during a key rotation, across real restarts', async () => {
    const folder = newFolder()
    const first = openGuardianStorage(folder)
    const keyring = await sealedKeyring(first.vault, PASSWORD, SEAL)
    const guardian = await open(first.guardian, keyring)
    const old = guardian.key
    keyring.activate = () => Promise.reject(new Error('power cut'))
    await expect(guardian.rotate()).rejects.toThrow('power cut')
    await first.close()

    const second = guardianStorage(folder)
    const again = await sealedKeyring(second.vault, PASSWORD, SEAL)
    expect(again.current().key).toBe(old)
    const restarted = await open(second.guardian, again)
    expect(restarted.locked).toBe(false)
    expect(restarted.key).not.toBe(old)
    expect(await checkLedger(restarted, old, null)).toMatchObject({ ok: true })
  })

  it('recovers from a crash between a line and its head', async () => {
    const folder = newFolder()
    const first = openGuardianStorage(folder)
    const keyring = await sealedKeyring(first.vault, PASSWORD, SEAL)
    const guardian = await open(first.guardian, keyring)
    first.guardian.publishHead = () => Promise.reject(new Error('power cut'))
    await expect(mint(guardian)).rejects.toThrow('power cut')
    await first.close()

    const second = guardianStorage(folder)
    const restarted = await open(second.guardian, await sealedKeyring(second.vault, PASSWORD, SEAL))
    expect(restarted.locked).toBe(false)
    expect((await restarted.head()).n).toBe(1)
  })

  it('locks a guardian whose database was rewritten', async () => {
    const folder = newFolder()
    const first = openGuardianStorage(folder)
    const keyring = memoryKeyring()
    await mint(await open(first.guardian, keyring))
    await first.close()

    const raw = new DatabaseSync(join(folder, 'guardian.sqlite'))
    raw.prepare('UPDATE lines SET hash = ? WHERE n = 1').run(hashOf('forged'))
    raw.close()

    const restarted = await open(guardianStorage(folder).guardian, keyring)
    expect(restarted.locked).toBe(true)
  })

  it('refuses a value spent twice in the database itself', async () => {
    const folder = newFolder()
    const storage = openGuardianStorage(folder)
    const value = hashOf('input')
    const line = { type: 'transition' as const, hash: hashOf('body'), date: DATE }
    await storage.guardian.transaction((tx) => tx.appendLine({ ...line, n: 1, spent: [value] }))
    await storage.close()

    const raw = new DatabaseSync(join(folder, 'guardian.sqlite'))
    raw.prepare(`INSERT INTO lines VALUES (2, 'transition', ?, ?, ?)`).run(value, DATE, value)
    const twice = raw.prepare('INSERT INTO spent (value, line, position) VALUES (?, 2, 0)')
    expect(() => twice.run(value)).toThrow(/UNIQUE/)
    raw.close()
  })

  it('keeps messages and witness data after a restart', async () => {
    const folder = newFolder()
    const first = openGuardianStorage(folder)
    const scan = generateSigner().key
    const message = { ephemeral: scan, ciphertext: 'AAAA' }
    const id = await first.mailboxes.add(scan, DATE, message)
    await first.close()
    expect((await guardianStorage(folder).mailboxes.list(scan))[0]?.id).toBe(id)

    const witnessFolder = newFolder()
    const witness = openWitnessStorage(witnessFolder)
    const head = { n: 1, root: hashOf('a'), date: DATE, signature: 'AAAA' }
    await witness.witness.recordHead(scan, head)
    await witness.close()
    const reopened = witnessStorage(witnessFolder)
    expect(await reopened.witness.recordHead(scan, { ...head, root: hashOf('b') })).toEqual(head)
  })

  it('refuses a second process on the same ledger', () => {
    const folder = newFolder()
    guardianStorage(folder)
    expect(() => openGuardianStorage(folder)).toThrow(/locked/)
  })

  it('does not depend on the vault it was given', async () => {
    const keyring = await sealedKeyring(new MemoryKeyVault(), PASSWORD, SEAL)
    const guardian = await open(guardianStorage().guardian, keyring)
    expect(guardian.key).toBe(keyring.current().key)
  })
})
