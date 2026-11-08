import type { Key } from '../../crypto/keys.ts'
import type { Directory, Submission } from '../../model/api.ts'
import type { Head } from '../../model/ledger.ts'

export type Trust = 'trusted' | 'unknown' | 'blocked'

export interface PartyContext {
  directory: Directory
  trustOf: (guardian: Key) => Trust
  /** Last head seen per guardian URL, updated by the ledger check. */
  lastSeen: Map<string, Head>
  /** Check 2: the transition is what its profile expects. */
  expects: (submission: Submission) => boolean | Promise<boolean>
  now?: Date
}

export type CheckName =
  | 'previous-final'
  | 'profile'
  | 'not-expired'
  | 'guardians-not-blocked'
  | 'unspent'
  | 'no-notice'
  | 'ledger'
  | 'guardians-trusted'

export interface Check {
  name: CheckName
  ok: boolean
  /** A blocking check must pass before the party adds its evidence. */
  blocking: boolean
}
