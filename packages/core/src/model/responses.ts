import { z } from 'zod'
import type { GuardianInfo } from './api.ts'
import type { Announcement, Head, Line, OwnerEntry, TokenHead } from './ledger.ts'
import { GroupSchema, OwnerSchema } from './parties.ts'
import { Base64UrlSchema, DateSchema, HashSchema, KeySchema } from './primitives.ts'
import { RotationSchema } from './token.ts'

/** Section 10 answers, for clients that do not trust the server they read from. */

const Count = z.number().int().nonnegative()

export const HeadSchema: z.ZodType<Head> = z.strictObject({
  n: Count,
  root: HashSchema,
  date: DateSchema,
  signature: Base64UrlSchema,
  locked: z.boolean().optional(),
})

export const LineSchema: z.ZodType<Line> = z.strictObject({
  n: z.number().int().positive(),
  type: z.enum([
    'creation',
    'transfer',
    'departure',
    'arrival',
    'catch_up',
    'announcement',
    'opposition',
    'takeover',
    'rotation',
  ]),
  token_id: HashSchema,
  state_hash: HashSchema,
  spent: HashSchema.nullable(),
  origin: z
    .union([
      z.strictObject({ guardian: KeySchema, line: z.number().int().positive() }),
      RotationSchema,
    ])
    .nullable(),
  date: DateSchema,
})

export const TokenHeadSchema: z.ZodType<TokenHead> = z.union([
  z.strictObject({ here: z.literal(true), state_hash: HashSchema, n: Count, sequence: Count }),
  z.strictObject({ here: z.literal(false), moved_to: GroupSchema, sequence: Count }),
])

export const AnnouncementSchema: z.ZodType<Announcement> = z.strictObject({
  token_id: HashSchema,
  state_hash: HashSchema,
  claimed_sequence: Count,
  ends_at: DateSchema,
  status: z.enum(['announced', 'opposed', 'taken_over']),
})

export const OwnerEntrySchema: z.ZodType<OwnerEntry> = z.strictObject({
  n: z.number().int().positive(),
  ephemeral: KeySchema.optional(),
  owner: OwnerSchema,
})

export const GuardianInfoSchema: z.ZodType<GuardianInfo> = z.strictObject({
  key: KeySchema,
  name: z.string(),
  url: z.url(),
  version: z.string(),
  policy: z.strictObject({ open: z.boolean() }),
  rotations: z.array(RotationSchema),
})

export const CountersignatureSchema = z.strictObject({
  guardian: KeySchema,
  n: Count,
  root: HashSchema,
  date: DateSchema,
  signature: Base64UrlSchema,
})

export const FraudProofSchema = z.strictObject({
  guardian: KeySchema,
  reason: z.string(),
  head_a: HeadSchema,
  head_b: HeadSchema.nullable(),
  date: DateSchema,
})

export const WitnessGuardianSchema = z.strictObject({
  key: KeySchema,
  url: z.url(),
  last_response: DateSchema.nullable(),
  head: CountersignatureSchema.nullable(),
  frauds: z.array(FraudProofSchema),
})

export type Countersignature = z.infer<typeof CountersignatureSchema>
export type FraudProof = z.infer<typeof FraudProofSchema>
export type WitnessGuardian = z.infer<typeof WitnessGuardianSchema>
