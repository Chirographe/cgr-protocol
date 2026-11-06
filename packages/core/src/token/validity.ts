import { hashOf, hashToBytes, sameValue } from '../crypto/hash.ts'
import { verifySignature } from '../crypto/keys.ts'
import { ProtocolError } from '../errors.ts'
import type { Group } from '../model/parties.ts'
import type { State, Token } from '../model/token.ts'
import { entryMessage, guardianMessage } from '../signing/messages.ts'
import { groupQuorum, ownerQuorum } from '../signing/quorum.ts'

/** How far a token has progressed (section 6). */
export type Stage = 'proposed' | 'complete' | 'final'

export interface ValidationContext {
  stage: Stage
  /** Previous state, when known. */
  previous?: State | undefined
  now?: Date
}

const invalidFormat = (message: string) => new ProtocolError('INVALID_FORMAT', message)
const invalidSignature = (message: string) => new ProtocolError('INVALID_SIGNATURE', message)

/** The group whose quorum signs this state, or `null` if only the previous state would tell. */
function signingGroup({ state, signatures }: Token, previous?: State): Group | null {
  if (state.previous === null || signatures.takeover) return state.guardian
  if (previous) return previous.guardian
  return signatures.incoming_guardians?.length ? null : state.guardian
}

/** Throws the error of the first rule of section 6 that fails. */
export function validateToken(token: Token, context: ValidationContext): void {
  const { rules, state, signatures } = token
  const { stage, previous } = context
  const { senders, takeover } = signatures
  const receivers = signatures.receivers ?? []
  const stateHash = hashOf(state)
  const signed = stage !== 'proposed'

  if (hashOf(rules) !== state.token_id) {
    throw new ProtocolError('RULES_TAMPERED', 'H(rules) does not match token_id')
  }

  if (state.previous === null) {
    if (!sameValue(state.owner, rules.creator)) {
      throw invalidFormat('a new token belongs to its creator')
    }
    if (!ownerQuorum(rules.creator, senders, stateHash)) {
      throw invalidSignature('creator quorum missing')
    }
    if (signatures.receivers) throw invalidFormat('a new token has no recipient')
    if (state.sequence !== 0 || !sameValue(state.guardian, rules.initial_guardian)) {
      throw invalidFormat('a new token starts at sequence 0 with initial_guardian')
    }
  } else if (previous) {
    if (hashOf(previous) !== state.previous) {
      throw new ProtocolError('UNKNOWN_STATE', 'previous is not the hash of the previous state')
    }
    if (state.sequence !== previous.sequence + 1) {
      throw invalidFormat('sequence must follow the previous state')
    }
    if (!ownerQuorum(previous.owner, senders, stateHash)) {
      throw invalidSignature('previous owner quorum missing')
    }
  }

  const message = hashToBytes(stateHash)
  for (const s of [...senders, ...receivers]) {
    if (!verifySignature(s.key, s.signature, message)) {
      throw invalidSignature('invalid owner signature')
    }
  }

  if (signed && !ownerQuorum(state.owner, [...senders, ...receivers], stateHash)) {
    throw invalidSignature('new owner quorum missing')
  }

  if (takeover) {
    if (!rules.recovery || !sameValue(state.guardian, rules.recovery.group)) {
      throw invalidFormat('recovery outside the recovery group')
    }
    if (previous && !sameValue(state.owner, previous.owner)) {
      throw invalidFormat('recovery cannot change the owner')
    }
  }

  const group = signingGroup(token, previous)
  const changes =
    !takeover && state.previous !== null && (group === null || !sameValue(group, state.guardian))
  if (changes && signed) {
    const entries = signatures.incoming_guardians ?? []
    if (!groupQuorum(state.guardian, entries, () => entryMessage(stateHash))) {
      throw invalidSignature('incoming group quorum missing')
    }
  }

  if (stage === 'final') {
    const votes = signatures.guardians ?? []
    const vote = (s: (typeof votes)[number]) => guardianMessage(stateHash, s.line, s.line_hash)
    if (group) {
      if (!groupQuorum(group, votes, vote)) throw invalidSignature('guardian quorum missing')
    } else if (!votes.some((s) => verifySignature(s.key, s.signature, vote(s)))) {
      throw invalidSignature('guardian signature missing')
    }
  }

  const allowed = rules.allowed_guardians
  if (allowed && !takeover && state.guardian.members.some((m) => !allowed.includes(m.key))) {
    throw new ProtocolError('GUARDIAN_NOT_ALLOWED', 'member absent from allowed_guardians')
  }

  if (stage !== 'final' && state.expires_at) {
    const now = context.now ?? new Date()
    if (now.getTime() >= Date.parse(state.expires_at)) {
      throw new ProtocolError('PROPOSAL_EXPIRED', 'expires_at has passed')
    }
  }
}
