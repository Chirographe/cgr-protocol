import type { Hash } from '../crypto/hash.ts'
import type { Key } from '../crypto/keys.ts'
import type { Predicate } from '../model/predicate.ts'

/** Builders, so that callers never spell predicates by hand. */
export const sig = (key: Key): Predicate => ({ sig: key })

export const threshold = (k: number, of: Predicate[]): Predicate => ({ threshold: k, of })

export const all = (...of: Predicate[]): Predicate =>
  of.length === 1 ? of[0]! : threshold(of.length, of)

export const any = (...of: Predicate[]): Predicate => (of.length === 1 ? of[0]! : threshold(1, of))

export const after = (date: Date): Predicate => ({ after: date.toISOString() })

export const before = (date: Date): Predicate => ({ before: date.toISOString() })

export const hashLock = (hash: Hash): Predicate => ({ hash })

export const member = (root: string, scheme: string): Predicate => ({ member: root, scheme })

/** `k` of these keys. */
export const keys = (k: number, list: Key[]): Predicate => threshold(k, list.map(sig))
