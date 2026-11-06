import { hashOf, sameValue } from '../crypto/hash.ts'
import type { Directory } from '../model/api.ts'
import type { Token } from '../model/token.ts'
import type { Signer } from '../signing/signer.ts'
import { composeProposal } from '../token/compose.ts'
import { broadcast, quorumCall, withVotes } from './quorum.ts'

/** Records a new token with its first group. */
export async function createToken(directory: Directory, token: Token): Promise<Token> {
  const group = token.state.guardian
  const votes = await quorumCall(directory, group, (guardian) => guardian.create(token))
  const final = withVotes(token, votes)
  await broadcast(directory, [group], { token: final, previous: null })
  return final
}

/** Records a complete proposal. Every step is idempotent: run it again to resume. */
export async function commit(
  directory: Directory,
  proposal: Token,
  previous: Token,
): Promise<Token> {
  const from = previous.state.guardian
  const to = proposal.state.guardian
  const changes = !sameValue(from, to)

  let token = proposal
  if (changes) {
    const answers = await quorumCall(directory, to, (g) => g.enter({ proposal, previous }))
    const incoming_guardians = answers.map((answer) => answer.incoming_guardian)
    token = { ...proposal, signatures: { ...proposal.signatures, incoming_guardians } }
  }

  await broadcast(directory, [from], { token: previous, previous: null })
  const validated = token
  const votes = await quorumCall(directory, from, (guardian) => guardian.validate(validated))
  const final = withVotes(token, votes)

  if (changes) {
    await quorumCall(directory, to, (guardian) => guardian.certify({ token: final, previous }))
  }
  await broadcast(directory, changes ? [from, to] : [from], { token: final, previous })
  return final
}

/** Announces a recovery. The delay runs from this call. */
export async function requestRecovery(
  directory: Directory,
  token: Token,
  signers: Signer[],
): Promise<{ proposal: Token; ends_at: string }> {
  const { recovery } = token.rules
  if (!recovery) throw new Error('this token has no recovery group')
  const proposal = await composeProposal(token, {
    signers,
    guardian: recovery.group,
    expiresIn: null,
    takeover: true,
  })
  const answers = await quorumCall(directory, recovery.group, (guardian) =>
    guardian.requestRecovery({ proposal, previous: token }),
  )
  const ends_at = answers
    .map((answer) => answer.ends_at)
    .sort()
    .at(-1) as string
  return { proposal, ends_at }
}

/** Completes a recovery once its delay has passed without opposition. */
export async function finalizeRecovery(
  directory: Directory,
  proposal: Token,
  previous: Token,
): Promise<Token> {
  const group = proposal.state.guardian
  const state_hash = hashOf(proposal.state)
  const votes = await quorumCall(directory, group, (guardian) =>
    guardian.finalizeRecovery({ state_hash }),
  )
  const final = withVotes(proposal, votes)
  await broadcast(directory, [group, previous.state.guardian], { token: final, previous })
  return final
}
