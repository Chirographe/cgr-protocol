import type { IndexEntry, NoticeRecord } from '../guardian/store.ts'
import type { Line } from '../model/ledger.ts'
import type { Rotation, Transition } from '../model/transition.ts'
import { DATE, KEY_A, hash } from './support.ts'

export const line = (n: number, fields: Partial<Line> = {}): Line => ({
  n,
  type: 'transition',
  hash: hash(`body ${n}`),
  spent: [],
  date: DATE,
  ...fields,
})

export const rotation = (label: string): Rotation => ({
  previous: `p256:${label}`,
  next: `p256:${label}x`,
  previous_signature: 'AAAA',
  next_signature: 'BBBB',
})

/** Opaque to a store: only its content must come back unchanged. */
export const transition = (label: string) =>
  ({
    format: 'chirographe/1',
    body: { inputs: [{ output: hash(label) }], outputs: [], data: { label } },
    evidence: {
      signatures: [{ type: 'raw', key: KEY_A, signature: 'AAAA' }],
      preimages: [],
      proofs: [],
    },
  }) as unknown as Transition

export const indexEntry = (token: string, fields: Partial<IndexEntry> = {}): IndexEntry => ({
  token,
  n: 1,
  output: hash('output'),
  transition: hash('body'),
  sequence: 0,
  here: true,
  moved_to: null,
  ...fields,
})

export const notice = (token: string, fields: Partial<NoticeRecord> = {}): NoticeRecord => ({
  token,
  transition: transition('takeover'),
  previous: [transition('previous')],
  output: hash('output'),
  sequence: 3,
  ends_at: DATE,
  status: 'open',
  line: 4,
  ...fields,
})
