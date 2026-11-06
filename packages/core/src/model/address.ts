import { z } from 'zod'
import { GroupSchema, OwnerSchema } from './parties.ts'
import { Base64UrlSchema, HashSchema, KeySchema } from './primitives.ts'
import { TokenSchema } from './token.ts'

export const AddressSchema = z
  .strictObject({
    scan: KeySchema,
    keys: z.array(KeySchema).min(1),
    threshold: z.number().int().positive(),
    relay: z.url(),
    stealth: z.boolean(),
  })
  .refine(
    (a) => OwnerSchema.safeParse({ keys: a.keys, threshold: a.threshold }).success,
    'invalid owner',
  )

export const EnvelopeSchema = z.strictObject({
  from: AddressSchema,
  proposal: TokenSchema,
  previous: TokenSchema,
})

export const RefusalSchema = z.strictObject({
  refused: HashSchema,
  reason: z.string().max(1000),
  requested_guardian: GroupSchema.nullable(),
})

export const RelayContentSchema = z.union([EnvelopeSchema, RefusalSchema, TokenSchema])

export const RelayMessageSchema = z.strictObject({
  ephemeral: KeySchema,
  ciphertext: Base64UrlSchema,
})

export type Address = z.infer<typeof AddressSchema>
export type Envelope = z.infer<typeof EnvelopeSchema>
export type Refusal = z.infer<typeof RefusalSchema>
export type RelayContent = z.infer<typeof RelayContentSchema>
export type RelayMessage = z.infer<typeof RelayMessageSchema>
