import { z } from 'zod'
import { FORMAT, LIMITS } from '../constants.ts'
import { parseWith } from '../errors.ts'
import { GroupSchema, RecoverySchema } from './group.ts'
import { ConstraintSchema, FieldElementSchema, PredicateSchema } from './predicate.ts'
import {
  Base64UrlSchema,
  DateSchema,
  HashSchema,
  KeySchema,
  NonceSchema,
  ValueSchema,
} from './primitives.ts'

export const RulesSchema = z.strictObject({
  profile: z.string().min(1).max(LIMITS.profileLength),
  issuer: PredicateSchema,
  covenant: z.array(ConstraintSchema),
  recovery: RecoverySchema.nullable(),
  group: GroupSchema,
  nonce: NonceSchema,
})

export const OutputSchema = z.strictObject({
  rules: RulesSchema,
  sequence: z.number().int().nonnegative(),
  lock: PredicateSchema,
  claim: PredicateSchema.optional(),
  data: ValueSchema.optional(),
  ephemeral: KeySchema.optional(),
  group: GroupSchema,
})

export const InputSchema = z.strictObject({
  output: HashSchema,
  nullifier: FieldElementSchema.optional(),
})

export const BodySchema = z
  .strictObject({
    group: GroupSchema,
    inputs: z.array(InputSchema).max(LIMITS.inputs),
    outputs: z.array(OutputSchema).max(LIMITS.outputs),
    data: ValueSchema.optional(),
    valid_until: DateSchema.optional(),
  })
  .refine(({ inputs, outputs }) => inputs.length + outputs.length > 0, 'empty transition')

export const SignatureSchema = z.strictObject({
  type: z.literal('raw'),
  key: KeySchema,
  signature: Base64UrlSchema,
})

export const ZkProofSchema = z.strictObject({
  scheme: z.string().min(1),
  nullifier: FieldElementSchema,
  proof: ValueSchema,
})

export const EvidenceSchema = z.strictObject({
  signatures: z.array(SignatureSchema),
  preimages: z.array(ValueSchema),
  proofs: z.array(ZkProofSchema),
})

export const RotationSchema = z.strictObject({
  previous: KeySchema,
  next: KeySchema,
  previous_signature: Base64UrlSchema,
  next_signature: Base64UrlSchema,
})

export const VoteSchema = z.strictObject({
  type: z.literal('raw'),
  key: KeySchema,
  signature: Base64UrlSchema,
  line: z.number().int().positive().optional(),
  line_hash: HashSchema.optional(),
  rotations: z.array(RotationSchema).optional(),
})

export const TransitionSchema = z.strictObject({
  format: z.literal(FORMAT),
  body: BodySchema,
  evidence: EvidenceSchema,
  guardians: z.array(VoteSchema).optional(),
  incoming: z.array(VoteSchema).optional(),
})

export type Rules = z.infer<typeof RulesSchema>
export type Output = z.infer<typeof OutputSchema>
export type Input = z.infer<typeof InputSchema>
export type Body = z.infer<typeof BodySchema>
export type Signature = z.infer<typeof SignatureSchema>
export type ZkProof = z.infer<typeof ZkProofSchema>
export type Evidence = z.infer<typeof EvidenceSchema>
export type Rotation = z.infer<typeof RotationSchema>
export type Vote = z.infer<typeof VoteSchema>
export type Transition = z.infer<typeof TransitionSchema>

export const parseTransition = (data: unknown): Transition =>
  parseWith(TransitionSchema, data, 'transition')
