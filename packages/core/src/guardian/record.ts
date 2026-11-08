import type { Hash } from '../crypto/hash.ts'
import { hashLine } from '../ledger/line.ts'
import type { Line } from '../model/ledger.ts'
import type { Transition } from '../model/transition.ts'
import { guardianMessage } from '../signing/messages.ts'
import { withVotes } from '../transition/evidence.ts'
import { bodyHash, isClaim, outputId, spentValue, tokenOf } from '../transition/ids.ts'
import { enteredGroups } from '../transition/validity.ts'
import type { GuardianCore } from './core.ts'
import type { IndexEntry, LedgerTransaction } from './store.ts'

/** A head only moves to a higher sequence (section 8). */
async function moveHead(tx: LedgerTransaction, entry: IndexEntry): Promise<void> {
  const current = await tx.index(entry.token)
  if (!current || entry.sequence > current.sequence) await tx.saveIndex(entry)
}

/** Indexes the outputs, the claims, and the tokens this transition ends. */
async function updateIndex(
  core: GuardianCore,
  tx: LedgerTransaction,
  transition: Transition,
  line: Line,
): Promise<void> {
  const hash = bodyHash(transition)
  const { inputs, outputs } = transition.body
  for (const output of outputs) {
    const here = await core.belongs(tx, output.group)
    await moveHead(tx, {
      token: tokenOf(output),
      n: line.n,
      output: outputId(output),
      transition: hash,
      sequence: output.sequence,
      here,
      moved_to: here ? null : output.group,
    })
  }
  const continued = new Set(outputs.map(tokenOf))
  const entries = await tx.indexEntries()
  for (const input of inputs) {
    if (isClaim(input)) {
      await tx.saveClaim({ output: input.output, transition: hash })
      continue
    }
    const ended = entries.find((e) => e.output === input.output && !continued.has(e.token))
    if (ended) {
      await moveHead(tx, {
        ...ended,
        n: line.n,
        transition: hash,
        sequence: ended.sequence + 1,
        here: false,
        moved_to: null,
      })
    }
  }
}

/**
 * Writes a `transition` line spending the inputs not yet spent here, indexes it,
 * and adds this guardian's vote when asked to.
 */
export async function recordTransition(
  core: GuardianCore,
  tx: LedgerTransaction,
  transition: Transition,
  options: { vote: boolean },
): Promise<{ transition: Transition; line: Line }> {
  const hash = bodyHash(transition)
  const spent: Hash[] = []
  for (const input of transition.body.inputs) {
    const value = spentValue(input)
    if (!(await tx.isSpent(value))) spent.push(value)
  }
  const line = await core.addLine(tx, { type: 'transition', hash, spent })
  const recorded = options.vote
    ? withVotes(transition, [
        await core.sign(tx, guardianMessage(hash, line.n, hashLine(line)), line),
      ])
    : transition
  await tx.saveTransition(hash, recorded)
  await updateIndex(core, tx, transition, line)
  return { transition: recorded, line }
}

/** Does this transition concern this guardian, as a member of its group or of an output group? */
export async function concerns(core: GuardianCore, tx: LedgerTransaction, transition: Transition) {
  for (const group of [transition.body.group, ...enteredGroups(transition.body)]) {
    if (await core.belongs(tx, group)) return true
  }
  return false
}

/** Section 8: a member first records the previous transitions it lacks. */
export async function catchUp(core: GuardianCore, tx: LedgerTransaction, previous: Transition[]) {
  for (const transition of previous) {
    if (await tx.transition(bodyHash(transition))) continue
    if (await concerns(core, tx, transition))
      await recordTransition(core, tx, transition, { vote: false })
  }
}
