import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it } from 'vitest'
import {
  Guardian,
  MemoryKeyVault,
  checkLedger,
  composeToken,
  generateWallet,
  hashOf,
  memoryKeyring,
  p256,
  sealedKeyring,
  signersForState,
  soleOwner,
  walletAddress,
  type GuardianStorage,
  type Token,
  type WitnessStorage,
} from '@chirographe/core'
import {
  guardianStoreCases,
  keyVaultCases,
  mailboxStoreCases,
  witnessStoreCases,
} from '@chirographe/core/conformance'
import { openGuardianStorage, openWitnessStorage } from '../src/index.ts'

const folders: string[] = []
const opened: (GuardianStorage | WitnessStorage)[] = []

function newFolder(): string {
  const folder = mkdtempSync(join(tmpdir(), 'chirographe-'))
  folders.push(folder)
  return folder
}

function guardianStorage(folder = newFolder()): GuardianStorage {
  const storage = openGuardianStorage(folder)
  opened.push(storage)
  return storage
}

function witnessStorage(folder = newFolder()): WitnessStorage {
  const storage = openWitnessStorage(folder)
  opened.push(storage)
  return storage
}

afterEach(async () => {
  await Promise.allSettled(opened.splice(0).map((storage) => storage.close()))
  for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true })
})

const suites = {
  guardian: guardianStoreCases(() => guardianStorage().guardian),
  mailboxes: mailboxStoreCases(() => guardianStorage().mailboxes),
  witness: witnessStoreCases(() => witnessStorage().witness),
  'guardian vault': keyVaultCases(() => guardianStorage().vault),
  'witness vault': keyVaultCases(() => witnessStorage().vault),
}

for (const [name, cases] of Object.entries(suites)) {
  describe(`sqlite ${name}`, () => {
    for (const { name, run } of cases) it(name, run)
  })
}

async function mint(guardian: Guardian): Promise<Token> {
  const wallet = generateWallet(p256, 1, 1)
  const address = walletAddress(wallet, 'https://relay.test', false)
  const owner = { keys: address.keys, threshold: address.threshold }
  const token = await composeToken({
    owner,
    signers: signersForState(wallet, { owner } as Token['state']),
    subject: 'Parcel 42',
    guardian: { members: [{ key: guardian.key, url: guardian.url }], threshold: 1 },
  })
  return guardian.create(token)
}

describe('sqlite durability', () => {
  const url = 'https://x.test'

  it('finds its ledger, head and key after a restart', async () => {
    const folder = newFolder()
    const first = openGuardianStorage(folder)
    const keyring = await sealedKeyring(first.vault, 'secret', { cost: 4 })
    const guardian = await Guardian.open({ name: 'x', url, store: first.guardian, keyring })
    const token = await mint(guardian)
    const head = await guardian.head()
    await first.close()

    const second = guardianStorage(folder)
    const again = await sealedKeyring(second.vault, 'secret', { cost: 4 })
    const restarted = await Guardian.open({
      name: 'x',
      url,
      store: second.guardian,
      keyring: again,
    })
    expect(restarted.key).toBe(guardian.key)
    expect(restarted.locked).toBe(false)
    expect(await restarted.head()).toEqual(head)
    expect(await restarted.tokenHead(token.state.token_id)).toMatchObject({ here: true })
  })

  it('recovers from a crash during a key rotation, across real restarts', async () => {
    const folder = newFolder()
    const seal = { cost: 4 }
    const first = openGuardianStorage(folder)
    const keyring = await sealedKeyring(first.vault, 'secret', seal)
    const guardian = await Guardian.open({ name: 'x', url, store: first.guardian, keyring })
    const old = guardian.key
    keyring.activate = () => Promise.reject(new Error('power cut'))
    await expect(guardian.rotate()).rejects.toThrow('power cut')
    await first.close()

    const second = guardianStorage(folder)
    const again = await sealedKeyring(second.vault, 'secret', seal)
    expect(again.current().key).toBe(old)
    const store = second.guardian
    const restarted = await Guardian.open({ name: 'x', url, store, keyring: again })
    expect(restarted.locked).toBe(false)
    expect(restarted.key).not.toBe(old)
    expect(await checkLedger(restarted, old, null)).toMatchObject({ ok: true })
  })

  it('recovers from a crash between a line and its head', async () => {
    const folder = newFolder()
    const first = openGuardianStorage(folder)
    const seal = { cost: 4 }
    const keyring = await sealedKeyring(first.vault, 'secret', seal)
    const guardian = await Guardian.open({ name: 'x', url, store: first.guardian, keyring })
    first.guardian.publishHead = () => Promise.reject(new Error('power cut'))
    await expect(mint(guardian)).rejects.toThrow('power cut')
    await first.close()

    const second = guardianStorage(folder)
    const again = await sealedKeyring(second.vault, 'secret', seal)
    const store = second.guardian
    const restarted = await Guardian.open({ name: 'x', url, store, keyring: again })
    expect(restarted.locked).toBe(false)
    expect((await restarted.head()).n).toBe(1)
  })

  it('locks a guardian whose database was rewritten', async () => {
    const folder = newFolder()
    const first = openGuardianStorage(folder)
    const keyring = memoryKeyring()
    const guardian = await Guardian.open({ name: 'x', url, store: first.guardian, keyring })
    await mint(guardian)
    await first.close()

    const raw = new DatabaseSync(join(folder, 'guardian.sqlite'))
    raw.prepare('UPDATE lines SET state_hash = ? WHERE n = 1').run(hashOf('forged'))
    raw.close()

    const second = guardianStorage(folder)
    const restarted = await Guardian.open({ name: 'x', url, store: second.guardian, keyring })
    expect(restarted.locked).toBe(true)
  })

  it('keeps messages and witness data after a restart', async () => {
    const folder = newFolder()
    const first = openGuardianStorage(folder)
    const scan = soleOwner('p256:AAAA').keys[0] as string
    const message = { ephemeral: scan, ciphertext: 'AAAA' }
    const id = await first.mailboxes.add(scan, '2026-11-06T12:00:00.000Z', message)
    await first.close()
    const second = guardianStorage(folder)
    expect((await second.mailboxes.list(scan))[0]?.id).toBe(id)

    const witnessFolder = newFolder()
    const witness = openWitnessStorage(witnessFolder)
    const head = { n: 1, root: hashOf('a'), date: '2026-11-06T12:00:00.000Z', signature: 'AAAA' }
    await witness.witness.recordHead(scan, head)
    await witness.close()
    const reopened = witnessStorage(witnessFolder)
    const other = { ...head, root: hashOf('b') }
    expect(await reopened.witness.recordHead(scan, other)).toEqual(head)
  })

  it('refuses a second process on the same ledger', () => {
    const folder = newFolder()
    guardianStorage(folder)
    expect(() => openGuardianStorage(folder)).toThrow(/locked/)
  })

  it('does not depend on the vault it was given', async () => {
    const vault = new MemoryKeyVault()
    const keyring = await sealedKeyring(vault, 'secret', { cost: 4 })
    const { guardian: store } = guardianStorage()
    const guardian = await Guardian.open({ name: 'x', url, store, keyring })
    expect(guardian.key).toBe(keyring.current().key)
  })
})
