import { describe, it } from 'vitest'
import {
  MemoryGuardianStore,
  MemoryKeyVault,
  MemoryMailboxStore,
  MemoryWitnessStore,
} from '../src/index.ts'
import {
  guardianStoreCases,
  keyVaultCases,
  mailboxStoreCases,
  witnessStoreCases,
} from '../src/conformance/index.ts'

describe('memory stores', () => {
  for (const { name, run } of guardianStoreCases(() => new MemoryGuardianStore())) it(name, run)
  for (const { name, run } of mailboxStoreCases(() => new MemoryMailboxStore())) it(name, run)
  for (const { name, run } of witnessStoreCases(() => new MemoryWitnessStore())) it(name, run)
  for (const { name, run } of keyVaultCases(() => new MemoryKeyVault())) it(name, run)
})
