import type { Hash } from '../crypto/hash.ts'
import { invalidFormat } from '../errors.ts'
import type { Output } from '../model/transition.ts'
import { isClaim, tokenOf } from './ids.ts'
import type { Resolved } from './resolve.ts'

/** An output with the output it continues, or `null` when it starts a token. */
export interface Continuation {
  output: Output
  spent: Output | null
}

function spentTokens(resolved: Resolved[]): Map<Hash, Output> {
  const tokens = new Map<Hash, Output>()
  for (const { input, output } of resolved) {
    if (isClaim(input)) continue
    const token = tokenOf(output)
    if (tokens.has(token)) throw invalidFormat('a token is spent twice')
    tokens.set(token, output)
  }
  return tokens
}

/** Section 3: each output starts a token or continues exactly one spent input. */
export function lineage(outputs: Output[], resolved: Resolved[]): Continuation[] {
  const spent = spentTokens(resolved)
  const seen = new Set<Hash>()
  return outputs.map((output) => {
    const token = tokenOf(output)
    if (seen.has(token)) throw invalidFormat('a token is continued twice')
    seen.add(token)
    const from = spent.get(token) ?? null
    if (output.sequence === 0) {
      if (from) throw invalidFormat('a spent token cannot start again')
      return { output, spent: null }
    }
    if (!from || output.sequence !== from.sequence + 1) {
      throw invalidFormat('an output continues no spent input')
    }
    return { output, spent: from }
  })
}
