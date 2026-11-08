import type { Directory } from '../../model/api.ts'
import type { Output } from '../../model/transition.ts'
import { outputId, tokenOf } from '../../transition/ids.ts'

/** Check 5: a quorum of the output's group reports it as the head, held there. */
export async function isHead(directory: Directory, output: Output): Promise<boolean> {
  const id = outputId(output)
  const results = await Promise.allSettled(
    output.group.members.map((m) => directory(m.url).tokenHead(tokenOf(output))),
  )
  const confirmed = results.filter(
    (r) => r.status === 'fulfilled' && r.value.here && r.value.output === id,
  ).length
  return confirmed >= output.group.threshold
}
