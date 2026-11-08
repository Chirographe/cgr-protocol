import { z } from 'zod'
import type { GuardianInfo } from './api.ts'
import { GroupSchema } from './group.ts'
import {
  LINE_TYPES,
  NOTICE_STATUSES,
  type Head,
  type Line,
  type Notice,
  type OwnerEntry,
  type TokenHead,
} from './ledger.ts'
import { Base64UrlSchema, DateSchema, HashSchema, KeySchema, UrlSchema } from './primitives.ts'
import { RotationSchema } from './transition.ts'

/** Section 10 answers, for clients that do not trust the server they read from. */

const Count = z.number().int().nonnegative()
const LineNumber = z.number().int().positive()

export const HeadSchema: z.ZodType<Head> = z.strictObject({
  n: Count,
  root: HashSchema,
  date: DateSchema,
  signature: Base64UrlSchema,
  locked: z.boolean().optional(),
})

export const LineSchema: z.ZodType<Line> = z.strictObject({
  n: LineNumber,
  type: z.enum(LINE_TYPES),
  hash: HashSchema,
  spent: z.array(HashSchema),
  date: DateSchema,
})

export const TokenHeadSchema: z.ZodType<TokenHead> = z.union([
  z.strictObject({ here: z.literal(true), output: HashSchema, n: Count, sequence: Count }),
  z.strictObject({ here: z.literal(false), moved_to: GroupSchema.nullable(), sequence: Count }),
])

export const NoticeSchema: z.ZodType<Notice> = z.strictObject({
  token: HashSchema,
  transition: HashSchema,
  sequence: Count,
  ends_at: DateSchema,
  status: z.enum(NOTICE_STATUSES),
})

export const OwnerEntrySchema: z.ZodType<OwnerEntry> = z.strictObject({
  n: LineNumber,
  ephemeral: KeySchema.optional(),
  keys: z.array(KeySchema),
})

export const GuardianInfoSchema: z.ZodType<GuardianInfo> = z.strictObject({
  key: KeySchema,
  name: z.string(),
  url: UrlSchema,
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
  url: UrlSchema,
  last_response: DateSchema.nullable(),
  head: CountersignatureSchema.nullable(),
  frauds: z.array(FraudProofSchema),
})

export type Countersignature = z.infer<typeof CountersignatureSchema>
export type FraudProof = z.infer<typeof FraudProofSchema>
export type WitnessGuardian = z.infer<typeof WitnessGuardianSchema>
