import type { Key } from '../crypto/keys.ts'
import type { GuardianApi } from '../model/api.ts'
import type { OwnerEntry } from '../model/ledger.ts'

const PAGE = 500

/** Section 5: finds the heads a holder may own on a guardian, from a match on their keys. */
export async function scanOwners(
  guardian: GuardianApi,
  matches: (keys: Key[], ephemeral?: Key) => boolean,
): Promise<OwnerEntry[]> {
  const found: OwnerEntry[] = []
  for (let from = 1; ;) {
    const page = await guardian.owners(from, PAGE)
    found.push(...page.filter((entry) => matches(entry.keys, entry.ephemeral)))
    const last = page.at(-1)
    if (!last || page.length < PAGE) return found
    from = last.n + 1
  }
}
