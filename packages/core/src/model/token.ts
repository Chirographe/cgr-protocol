import { z } from 'zod'
import { FORMAT } from '../constants.ts'
import { ProtocolError } from '../errors.ts'
import { GroupSchema, OwnerSchema, RecoverySchema } from './parties.ts'
import { Base64UrlSchema, DateSchema, HashSchema, KeySchema } from './primitives.ts'

export const RulesSchema = z.strictObject({
  creator: OwnerSchema,
  subject: z.string().min(1).max(500),
  description: z.string().max(5000).nullable().optional(),
  nonce: z.string().regex(/^[0-9a-f]{32}$/, 'invalid nonce'),
  created_at: DateSchema,
  initial_guardian: GroupSchema,
  allowed_guardians: z.array(KeySchema).nullable(),
  recovery: RecoverySchema.nullable(),
})

export const StateSchema = z.strictObject({
  token_id: HashSchema,
  sequence: z.number().int().nonnegative(),
  previous: HashSchema.nullable(),
  owner: OwnerSchema,
  ephemeral: KeySchema.optional(),
  guardian: GroupSchema,
  date: DateSchema,
  expires_at: DateSchema.optional(),
})

export const OwnerSignatureSchema = z.strictObject({
  type: z.literal('raw'),
  key: KeySchema,
  signature: Base64UrlSchema,
})

export const RotationSchema = z.strictObject({
  previous: KeySchema,
  next: KeySchema,
  previous_signature: Base64UrlSchema,
  next_signature: Base64UrlSchema,
})

export const GuardianSignatureSchema = z.strictObject({
  type: z.literal('raw'),
  key: KeySchema,
  line: z.number().int().positive(),
  line_hash: HashSchema,
  signature: Base64UrlSchema,
  rotations: z.array(RotationSchema).optional(),
})

export const EntrySignatureSchema = z.strictObject({
  type: z.literal('raw'),
  key: KeySchema,
  signature: Base64UrlSchema,
  rotations: z.array(RotationSchema).optional(),
})

export const TokenSchema = z.strictObject({
  format: z.literal(FORMAT),
  rules: RulesSchema,
  state: StateSchema,
  signatures: z.strictObject({
    senders: z.array(OwnerSignatureSchema).min(1),
    receivers: z.array(OwnerSignatureSchema).optional(),
    guardians: z.array(GuardianSignatureSchema).optional(),
    incoming_guardians: z.array(EntrySignatureSchema).optional(),
    takeover: z.literal(true).optional(),
  }),
})

export type Rules = z.infer<typeof RulesSchema>
export type State = z.infer<typeof StateSchema>
export type OwnerSignature = z.infer<typeof OwnerSignatureSchema>
export type Rotation = z.infer<typeof RotationSchema>
export type GuardianSignature = z.infer<typeof GuardianSignatureSchema>
export type EntrySignature = z.infer<typeof EntrySignatureSchema>
export type Token = z.infer<typeof TokenSchema>

/** Parses untrusted input into a token. */
export function parseToken(data: unknown): Token {
  const result = TokenSchema.safeParse(data)
  if (!result.success) {
    throw new ProtocolError('INVALID_FORMAT', result.error.issues[0]?.message ?? 'invalid token')
  }
  return result.data
}
