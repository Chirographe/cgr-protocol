import { ProtocolError } from '../errors.ts'
import type { Certificate, Directory, GuardianApi } from '../model/api.ts'
import type { Group } from '../model/parties.ts'
import type { GuardianSignature, Token } from '../model/token.ts'

/** Fewer than `threshold` members answered, with no protocol refusal to report. */
export class QuorumError extends Error {
  override readonly name = 'QuorumError'
}

/** Calls every member in parallel and requires `threshold` positive answers. */
export async function quorumCall<T>(
  directory: Directory,
  group: Group,
  call: (guardian: GuardianApi) => Promise<T>,
): Promise<T[]> {
  // A member that cannot even be reached counts as a failure, not as an error of the whole call.
  const results = await Promise.allSettled(
    group.members.map(async (member) => call(directory(member.url))),
  )
  const answers = results.flatMap((r) => (r.status === 'fulfilled' ? [r.value] : []))
  if (answers.length >= group.threshold) return answers

  const refusals = results.flatMap((r) =>
    r.status === 'rejected' && r.reason instanceof ProtocolError ? [r.reason] : [],
  )
  const count = (code: string) => refusals.filter((r) => r.code === code).length
  const [main] = [...refusals].sort((a, b) => count(b.code) - count(a.code))
  if (main) throw main
  throw new QuorumError(`${answers.length} of ${group.threshold} required answers`)
}

/** Sends a certificate to every member, without requiring a quorum. */
export async function broadcast(
  directory: Directory,
  groups: Group[],
  certificate: Certificate,
): Promise<void> {
  const urls = new Set(groups.flatMap((group) => group.members.map((member) => member.url)))
  await Promise.allSettled([...urls].map(async (url) => directory(url).certify(certificate)))
}

/** Merges votes into the token, one per key. */
export function withVotes(token: Token, votes: Token[]): Token {
  const seen = new Map<string, GuardianSignature>()
  for (const vote of [token, ...votes]) {
    for (const signature of vote.signatures.guardians ?? []) seen.set(signature.key, signature)
  }
  return { ...token, signatures: { ...token.signatures, guardians: [...seen.values()] } }
}
