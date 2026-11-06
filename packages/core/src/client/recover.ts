import { owns, type Wallet } from '../address/stealth.ts'
import type { GuardianApi } from '../model/api.ts'
import type { OwnerEntry } from '../model/ledger.ts'

const PAGE = 500

/** Finds what a wallet owns on a guardian, from its private keys alone. */
export async function scanOwners(guardian: GuardianApi, wallet: Wallet): Promise<OwnerEntry[]> {
  const found: OwnerEntry[] = []
  let from = 1
  for (;;) {
    const page = await guardian.owners(from, PAGE)
    found.push(...page.filter((entry) => owns(wallet, entry.owner, entry.ephemeral)))
    const last = page.at(-1)
    if (!last || page.length < PAGE) return found
    from = last.n + 1
  }
}
