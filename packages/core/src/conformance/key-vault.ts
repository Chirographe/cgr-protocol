import type { KeyVault } from '../guardian/keyring.ts'
import { check, type ConformanceCase, type Open } from './support.ts'

export function keyVaultCases(open: Open<KeyVault>): ConformanceCase[] {
  return [
    {
      name: 'keeps the last value saved',
      run: async () => {
        const vault = await open()
        check((await vault.load()) === null, 'a new vault is not empty')
        await vault.save('first')
        await vault.save('second')
        check((await vault.load()) === 'second', 'wrong vault content')
      },
    },
  ]
}
