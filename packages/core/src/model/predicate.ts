import { z } from 'zod'
import type { Hash } from '../crypto/hash.ts'
import type { Key } from '../crypto/keys.ts'
import { fitsLimits } from '../predicate/shape.ts'
import { DateSchema, HashSchema, KeySchema } from './primitives.ts'

/** Section 3. A predicate decides who may spend an output, claim under it, or start a token. */
export type Predicate =
  | { sig: Key }
  | { threshold: number; of: Predicate[] }
  | { after: string }
  | { before: string }
  | { hash: Hash }
  | { member: string; scheme: string }

const FieldElementSchema = z.string().regex(/^(0|[1-9][0-9]*)$/, 'invalid field element')

const NodeSchema: z.ZodType<Predicate> = z.lazy(() =>
  z.union([
    z.strictObject({ sig: KeySchema }),
    z
      .strictObject({ threshold: z.number().int().positive(), of: z.array(NodeSchema).min(1) })
      .refine(({ threshold, of }) => threshold <= of.length, 'threshold above its predicates'),
    z.strictObject({ after: DateSchema }),
    z.strictObject({ before: DateSchema }),
    z.strictObject({ hash: HashSchema }),
    z.strictObject({ member: FieldElementSchema, scheme: z.string().min(1) }),
  ]),
)

export const PredicateSchema: z.ZodType<Predicate> = NodeSchema.refine(
  fitsLimits,
  'predicate too deep, too large, or with a repeated key',
)

export const KEPT_FIELDS = ['lock', 'claim', 'data'] as const

/** Section 3. Holds on each output that continues a token, against the output it spends. */
export type Constraint =
  { keep: (typeof KEPT_FIELDS)[number][] } | { groups: Key[] } | { accept: true }

export const ConstraintSchema: z.ZodType<Constraint> = z.union([
  z.strictObject({ keep: z.array(z.enum(KEPT_FIELDS)).min(1) }),
  z.strictObject({ groups: z.array(KeySchema).min(1) }),
  z.strictObject({ accept: z.literal(true) }),
])

export { FieldElementSchema }
