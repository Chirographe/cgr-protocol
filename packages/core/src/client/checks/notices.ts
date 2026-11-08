import type { Directory } from '../../model/api.ts'
import type { Output } from '../../model/transition.ts'
import { tokenOf } from '../../transition/ids.ts'
import { noticesOf } from '../recovery.ts'

/** Check 6: no notice is open on the token, or completed on this output or a later one. */
export async function hasNotice(directory: Directory, output: Output): Promise<boolean> {
  const recovery = output.rules.recovery
  if (!recovery) return false
  const token = tokenOf(output)
  const reports = await noticesOf(directory, recovery.group)
  return reports
    .flat()
    .some(
      (n) =>
        n.token === token &&
        (n.status === 'open' || (n.status === 'completed' && n.sequence >= output.sequence)),
    )
}
