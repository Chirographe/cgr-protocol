import { FORMAT } from '../constants.ts'
import { hashOf, hashToBytes } from '../crypto/hash.ts'
import type { Key } from '../crypto/keys.ts'
import { randomBytes, toHex } from '../encoding/bytes.ts'
import type { Group, Owner, Recovery } from '../model/parties.ts'
import type { OwnerSignature, Rules, State, Token } from '../model/token.ts'
import type { Signer } from '../signing/signer.ts'

const NONCE_BYTES = 16

async function signState(state: State, signers: Signer[]): Promise<OwnerSignature[]> {
  const message = hashToBytes(hashOf(state))
  return Promise.all(
    signers.map(async (signer) => ({
      type: 'raw' as const,
      key: signer.key,
      signature: await signer.sign(message),
    })),
  )
}

export interface NewToken {
  owner: Owner
  /** Enough keys of the owner to reach its threshold. */
  signers: Signer[]
  subject: string
  description?: string | null
  guardian: Group
  allowed_guardians?: Key[] | null
  recovery?: Recovery | null
  ephemeral?: Key
  now?: Date
}

/** A token ready to be recorded by its first group. */
export async function composeToken(input: NewToken): Promise<Token> {
  const date = (input.now ?? new Date()).toISOString()
  const rules: Rules = {
    creator: input.owner,
    subject: input.subject,
    description: input.description ?? null,
    nonce: toHex(randomBytes(NONCE_BYTES)),
    created_at: date,
    initial_guardian: input.guardian,
    allowed_guardians: input.allowed_guardians ?? null,
    recovery: input.recovery ?? null,
  }
  const state: State = {
    token_id: hashOf(rules),
    sequence: 0,
    previous: null,
    owner: input.owner,
    ...(input.ephemeral ? { ephemeral: input.ephemeral } : {}),
    guardian: input.guardian,
    date,
  }
  return {
    format: FORMAT,
    rules,
    state,
    signatures: { senders: await signState(state, input.signers) },
  }
}

export interface Proposal {
  /** Enough keys of the current owner to reach its threshold. */
  signers: Signer[]
  /** New owner, with its `ephemeral` if one-time. Omit to keep the current one. */
  recipient?: { owner: Owner; ephemeral?: Key }
  guardian?: Group
  /** Lifetime in seconds. `null` means no expiry. */
  expiresIn: number | null
  takeover?: true
  now?: Date
}

/** A new state signed by the current owner. */
export async function composeProposal(token: Token, proposal: Proposal): Promise<Token> {
  const now = proposal.now ?? new Date()
  const { state } = token
  const ephemeral = proposal.recipient ? proposal.recipient.ephemeral : state.ephemeral
  const next: State = {
    token_id: state.token_id,
    sequence: state.sequence + 1,
    previous: hashOf(state),
    owner: proposal.recipient?.owner ?? state.owner,
    ...(ephemeral ? { ephemeral } : {}),
    guardian: proposal.guardian ?? state.guardian,
    date: now.toISOString(),
    ...(proposal.expiresIn === null
      ? {}
      : { expires_at: new Date(now.getTime() + proposal.expiresIn * 1000).toISOString() }),
  }
  return {
    format: FORMAT,
    rules: token.rules,
    state: next,
    signatures: {
      senders: await signState(next, proposal.signers),
      ...(proposal.takeover ? { takeover: true as const } : {}),
    },
  }
}

/** Adds the recipient's signatures. */
export async function acceptProposal(proposal: Token, signers: Signer[]): Promise<Token> {
  const receivers = await signState(proposal.state, signers)
  return { ...proposal, signatures: { ...proposal.signatures, receivers } }
}
