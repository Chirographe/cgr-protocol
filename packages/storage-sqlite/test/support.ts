import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach } from 'vitest'
import type { GuardianStorage, WitnessStorage } from '@chirographe/core'
import { openGuardianStorage, openWitnessStorage } from '../src/index.ts'

const folders: string[] = []
const opened: (GuardianStorage | WitnessStorage)[] = []

afterEach(async () => {
  await Promise.allSettled(opened.splice(0).map((storage) => storage.close()))
  for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true })
})

/** A temporary folder, removed after each test. */
export function newFolder(): string {
  const folder = mkdtempSync(join(tmpdir(), 'chirographe-'))
  folders.push(folder)
  return folder
}

/** Guardian storage closed after each test. */
export function guardianStorage(folder = newFolder()): GuardianStorage {
  const storage = openGuardianStorage(folder)
  opened.push(storage)
  return storage
}

/** Witness storage closed after each test. */
export function witnessStorage(folder = newFolder()): WitnessStorage {
  const storage = openWitnessStorage(folder)
  opened.push(storage)
  return storage
}
