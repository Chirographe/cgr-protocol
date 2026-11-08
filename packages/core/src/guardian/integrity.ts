import { verifySignature, type Key } from '../crypto/keys.ts'
import { findDoubleSpend, hashLine, ledgerRoot } from '../ledger/line.ts'
import type { Head, Line } from '../model/ledger.ts'
import { headMessage } from '../signing/messages.ts'

/** An operation writes one line at most, so a crash leaves at most this many unpublished. */
const MAX_UNPUBLISHED_LINES = 1

/** Section 8. A line past the head is a crash before publication, not a rewritten ledger. */
export function ledgerMismatch(lines: Line[], head: Head | null, keys: Key[]): string | null {
  const fraud = findDoubleSpend(lines)
  if (fraud !== null) return `line ${fraud} spends a value twice`
  if (!head) return lines.length > 0 ? 'published head missing' : null

  const message = headMessage(head.n, head.root)
  if (!keys.some((key) => verifySignature(key, head.signature, message))) {
    return 'published head has an invalid signature'
  }
  const unpublished = lines.length - head.n
  const published = lines.slice(0, head.n).map(hashLine)
  if (
    unpublished < 0 ||
    unpublished > MAX_UNPUBLISHED_LINES ||
    ledgerRoot(published) !== head.root
  ) {
    return 'ledger does not match the published head'
  }
  return null
}
