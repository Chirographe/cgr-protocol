import { describe, it } from 'vitest'
import {
  guardianStoreCases,
  keyVaultCases,
  mailboxStoreCases,
  witnessStoreCases,
} from '@chirographe/core/conformance'
import { guardianStorage, witnessStorage } from './support.ts'

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
