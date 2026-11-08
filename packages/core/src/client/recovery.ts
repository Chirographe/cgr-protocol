import type { Directory } from '../model/api.ts'
import type { Notice } from '../model/ledger.ts'
import type { Group } from '../model/group.ts'
import type { Transition } from '../model/transition.ts'
import { quorumCall } from './quorum.ts'

/** Section 7: announces a takeover on its recovery group. The delay runs from this call. */
export async function announceTakeover(
  directory: Directory,
  transition: Transition,
  previous: Transition[],
): Promise<{ ends_at: string }> {
  const answers = await quorumCall(directory, transition.body.group, (g) =>
    g.notice({ transition, previous }),
  )
  return {
    ends_at: answers
      .map((a) => a.ends_at)
      .sort()
      .at(-1) as string,
  }
}

/** Shows a later state to a recovery group, which closes its notice. */
export async function opposeTakeover(
  directory: Directory,
  group: Group,
  transition: Transition,
  previous: Transition[],
): Promise<void> {
  await quorumCall(directory, group, (g) => g.oppose({ transition, previous }))
}

/** Notices that members of a group report, member by member. Unreachable members are skipped. */
export async function noticesOf(directory: Directory, group: Group): Promise<Notice[][]> {
  const results = await Promise.allSettled(group.members.map((m) => directory(m.url).notices()))
  return results.flatMap((r) => (r.status === 'fulfilled' ? [r.value] : []))
}
