import { describe, it } from 'vitest'
import {
  guardianStoreCases,
  keyVaultCases,
  mailboxStoreCases,
  witnessStoreCases,
} from '../src/conformance/index.ts'
import {
  MemoryGuardianStore,
  MemoryKeyVault,
  MemoryMailboxStore,
  MemoryWitnessStore,
} from '../src/index.ts'

const suites = {
  MemoryGuardianStore: guardianStoreCases(() => new MemoryGuardianStore()),
  MemoryMailboxStore: mailboxStoreCases(() => new MemoryMailboxStore()),
  MemoryWitnessStore: witnessStoreCases(() => new MemoryWitnessStore()),
  MemoryKeyVault: keyVaultCases(() => new MemoryKeyVault()),
}

for (const [name, cases] of Object.entries(suites)) {
  describe(name, () => {
    for (const { name, run } of cases) it(name, run)
  })
}
