import { hashOf, sameValue, type Hash } from '../crypto/hash.ts'
import type { Head } from '../model/ledger.ts'

/**
 * What any storage technology must guarantee. Each adapter runs these cases in its own tests,
 * with whatever test runner it uses. A case fails by throwing.
 */
export interface ConformanceCase {
  name: string
  run(): Promise<void>
}

export type Open<T> = () => T | Promise<T>

export function check(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

export const same = (actual: unknown, expected: unknown, message: string) =>
  check(sameValue(actual, expected), message)

export async function rejects(work: () => Promise<unknown>, message: string): Promise<void> {
  let failed = false
  await work().catch(() => {
    failed = true
  })
  check(failed, message)
}

export const tick = () => new Promise((resolve) => setTimeout(resolve, 1))

export const DATE = '2026-11-06T12:00:00.000Z'
export const KEY_A = 'p256:AAAA'
export const KEY_B = 'p256:BBBB'

export const hash = (label: string): Hash => hashOf(label)

export const head = (n: number, label = 'root'): Head => ({
  n,
  root: hash(label),
  date: DATE,
  signature: 'AAAA',
})

/** Runs each case on a fresh instance. */
export const casesOn =
  <T>(open: Open<T>) =>
  (name: string, run: (store: T) => Promise<void>): ConformanceCase => ({
    name,
    run: async () => run(await open()),
  })
