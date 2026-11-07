import { isSoleOwner, type Wallet } from '../address/stealth.ts'
import { hashOf } from '../crypto/hash.ts'
import type { Key } from '../crypto/keys.ts'
import { ProtocolError } from '../errors.ts'
import type { Envelope } from '../model/address.ts'
import type { Directory } from '../model/api.ts'
import type { Head } from '../model/ledger.ts'
import { toleratedFaults } from '../model/parties.ts'
import { keyHistory } from '../signing/rotations.ts'
import { ownerQuorum } from '../signing/quorum.ts'
import { validateToken } from '../token/validity.ts'
import { checkLedger, checkTokenLine } from './ledger-check.ts'

export type Trust = 'trusted' | 'unknown' | 'blocked'

export type CheckName =
  | 'rules'
  | 'chain'
  | 'previous-final'
  | 'owner-signed'
  | 'mine'
  | 'not-expired'
  | 'guardians-not-blocked'
  | 'unspent'
  | 'no-recovery'
  | 'ledger'
  | 'guardians-trusted'

export interface Check {
  name: CheckName
  ok: boolean
  /** A blocking check must pass before the recipient signs. */
  blocking: boolean
}

export interface RecipientContext {
  directory: Directory
  trustOf: (guardian: Key) => Trust
  /** Last head seen per guardian URL, updated by the ledger check. */
  lastSeen: Map<string, Head>
  now?: Date
}

function isFinal(token: Envelope['previous']): boolean {
  try {
    validateToken(token, { stage: 'final' })
    return true
  } catch (error) {
    if (error instanceof ProtocolError) return false
    throw error
  }
}

async function confirmations({ previous, proposal }: Envelope, directory: Directory) {
  const results = await Promise.allSettled(
    previous.state.guardian.members.map(async (m) =>
      directory(m.url).tokenHead(proposal.state.token_id),
    ),
  )
  const stateHash = proposal.state.previous
  return results.filter(
    (r) => r.status === 'fulfilled' && r.value.here && r.value.state_hash === stateHash,
  ).length
}

async function recoveryAnnounced({ proposal, previous }: Envelope, directory: Directory) {
  const { recovery } = proposal.rules
  if (!recovery) return false
  const results = await Promise.allSettled(
    recovery.group.members.map(async (m) => directory(m.url).announcements()),
  )
  return results.some(
    (r) =>
      r.status === 'fulfilled' &&
      r.value.some(
        (a) =>
          a.token_id === proposal.state.token_id &&
          a.status !== 'opposed' &&
          // A finished recovery only stands against the states that came before it.
          !(a.status === 'taken_over' && previous.state.sequence > a.claimed_sequence),
      ),
  )
}

/** Ledger check of every guardian that signed the previous token. */
async function ledgersHold({ previous }: Envelope, context: RecipientContext) {
  const { directory, lastSeen } = context
  const signatures = previous.signatures.guardians ?? []
  const results = await Promise.all(
    signatures.map(async (signature) => {
      const history = keyHistory(signature.key, signature.rotations)
      const member = previous.state.guardian.members.find((m) => history.includes(m.key))
      if (!member) return true
      try {
        const guardian = directory(member.url)
        const status = await checkLedger(guardian, member.key, lastSeen.get(member.url) ?? null)
        if (!status.ok) return false
        lastSeen.set(member.url, status.head)
        return await checkTokenLine(guardian, previous.state, signature, status.head)
      } catch {
        return false
      }
    }),
  )
  return results.every(Boolean)
}

/** Runs the checks of section 9 on a received envelope. */
export async function inspectEnvelope(
  envelope: Envelope,
  wallet: Wallet,
  context: RecipientContext,
): Promise<Check[]> {
  const { proposal, previous } = envelope
  const { state, rules, signatures } = proposal
  const now = context.now ?? new Date()
  const trust = state.guardian.members.map((m) => context.trustOf(m.key))
  const blocked = trust.filter((level) => level === 'blocked').length
  const [heads, recovery, ledgers] = await Promise.all([
    confirmations(envelope, context.directory),
    recoveryAnnounced(envelope, context.directory),
    ledgersHold(envelope, context),
  ])
  const check = (name: CheckName, ok: boolean, blocking = true): Check => ({ name, ok, blocking })
  return [
    check('rules', hashOf(rules) === state.token_id),
    check('chain', hashOf(previous.state) === state.previous),
    check('previous-final', isFinal(previous)),
    check('owner-signed', ownerQuorum(previous.state.owner, signatures.senders, hashOf(state))),
    check('mine', isSoleOwner(wallet, state.owner, state.ephemeral)),
    check('not-expired', !state.expires_at || now.getTime() < Date.parse(state.expires_at)),
    check('guardians-not-blocked', blocked <= toleratedFaults(trust.length)),
    check('unspent', heads >= previous.state.guardian.threshold),
    check('no-recovery', !recovery),
    check('ledger', ledgers, false),
    check(
      'guardians-trusted',
      trust.every((level) => level === 'trusted'),
      false,
    ),
  ]
}

export const canAccept = (checks: Check[]): boolean =>
  checks.every((check) => check.ok || !check.blocking)
