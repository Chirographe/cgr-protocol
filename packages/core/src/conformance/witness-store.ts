import type { FraudProof } from '../model/responses.ts'
import type { Followed, WitnessStore } from '../witness/store.ts'
import {
  DATE,
  KEY_A,
  KEY_B,
  casesOn,
  check,
  hash,
  head,
  same,
  type ConformanceCase,
  type Open,
} from './support.ts'

const followed = (key: string, fields: Partial<Followed> = {}): Followed => ({
  key,
  url: 'https://a.test',
  current: key,
  lastAnswer: null,
  lastHead: null,
  countersignature: null,
  ...fields,
})

const fraud = (guardian: string, reason: string, root: string): FraudProof => ({
  guardian,
  reason,
  head_a: head(1, root),
  head_b: null,
  date: DATE,
})

export function witnessStoreCases(open: Open<WitnessStore>): ConformanceCase[] {
  const inStore = casesOn(open)
  return [
    inStore('keeps one entry per guardian', async (store) => {
      const countersignature = {
        guardian: KEY_A,
        n: 1,
        root: hash('root'),
        date: DATE,
        signature: 'AAAA',
      }
      const updated = followed(KEY_A, {
        current: KEY_B,
        lastAnswer: DATE,
        lastHead: head(1),
        countersignature,
      })
      await store.saveFollowed(followed(KEY_A))
      await store.saveFollowed(followed(KEY_B))
      await store.saveFollowed(updated)
      const entries = await store.followed()
      check(entries.length === 2, 'wrong number of entries')
      same(
        entries.find((entry) => entry.key === KEY_A),
        updated,
        'entry not replaced',
      )
    }),

    inStore('keeps the first head seen at each line', async (store) => {
      same(await store.recordHead(KEY_A, head(1, 'a')), head(1, 'a'), 'first head not returned')
      same(await store.recordHead(KEY_A, head(1, 'b')), head(1, 'a'), 'first head was replaced')
      same(await store.recordHead(KEY_A, head(2, 'b')), head(2, 'b'), 'lines are mixed up')
      same(await store.recordHead(KEY_B, head(1, 'b')), head(1, 'b'), 'guardians are mixed up')
    }),

    inStore('records concurrent heads atomically', async (store) => {
      const kept = await Promise.all([
        store.recordHead(KEY_A, head(1, 'a')),
        store.recordHead(KEY_A, head(1, 'b')),
      ])
      same(kept[0], kept[1], 'two heads were kept for one line')
    }),

    inStore('keeps one proof per reason and root', async (store) => {
      const first = await store.recordFraud(fraud(KEY_A, 'fork', 'a'))
      same(first, fraud(KEY_A, 'fork', 'a'), 'proof not returned')
      const later = { ...fraud(KEY_A, 'fork', 'a'), date: '2027-01-01T00:00:00.000Z' }
      same(await store.recordFraud(later), first, 'the first proof was not kept')
      await store.recordFraud(fraud(KEY_A, 'fork', 'b'))
      await store.recordFraud(fraud(KEY_A, 'other', 'a'))
      await store.recordFraud(fraud(KEY_B, 'fork', 'a'))
      same(
        await store.frauds(KEY_A),
        [fraud(KEY_A, 'fork', 'a'), fraud(KEY_A, 'fork', 'b'), fraud(KEY_A, 'other', 'a')],
        'wrong proofs',
      )
    }),
  ]
}
