import { LIMITS } from '../constants.ts'
import type { Key } from '../crypto/keys.ts'
import type { Predicate } from '../model/predicate.ts'

/** Every `sig` key of a predicate, in order. These are the keys a holder may sign with. */
export function predicateKeys(predicate: Predicate): Key[] {
  if ('sig' in predicate) return [predicate.sig]
  if ('of' in predicate) return predicate.of.flatMap(predicateKeys)
  return []
}

function depth(predicate: Predicate): number {
  return 'of' in predicate ? 1 + Math.max(...predicate.of.map(depth)) : 1
}

function leaves(predicate: Predicate): number {
  return 'of' in predicate ? predicate.of.reduce((sum, p) => sum + leaves(p), 0) : 1
}

/** Depth, leaf count and distinct keys of section 3. */
export function fitsLimits(predicate: Predicate): boolean {
  const keys = predicateKeys(predicate)
  return (
    depth(predicate) <= LIMITS.predicateDepth &&
    leaves(predicate) <= LIMITS.predicateLeaves &&
    new Set(keys).size === keys.length
  )
}
