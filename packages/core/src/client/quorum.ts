import { ProtocolError } from '../errors.ts'
import type { Directory, GuardianApi, Submission } from '../model/api.ts'
import type { Group } from '../model/group.ts'

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
  const results = await Promise.allSettled(group.members.map(async (m) => call(directory(m.url))))
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

/** Sends a final transition to every member of these groups, without requiring a quorum. */
export async function broadcast(
  directory: Directory,
  groups: Group[],
  submission: Submission,
): Promise<void> {
  const urls = new Set(groups.flatMap((group) => group.members.map((member) => member.url)))
  await Promise.allSettled([...urls].map(async (url) => directory(url).certify(submission)))
}
