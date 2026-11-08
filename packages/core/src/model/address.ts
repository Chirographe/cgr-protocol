import { z } from 'zod'
import { LIMITS } from '../constants.ts'
import { Base64UrlSchema, HashSchema, KeySchema, UrlSchema } from './primitives.ts'
import { TransitionSchema } from './transition.ts'

export const AddressSchema = z
  .strictObject({
    scan: KeySchema,
    keys: z.array(KeySchema).min(1).max(LIMITS.predicateLeaves),
    threshold: z.number().int().positive(),
    relay: UrlSchema,
    stealth: z.boolean(),
  })
  .refine(({ keys, threshold }) => threshold <= keys.length, 'threshold above key count')
  .refine(({ keys }) => new Set(keys).size === keys.length, 'duplicate key')

export const RequestSchema = z.strictObject({
  from: AddressSchema,
  transition: TransitionSchema,
  previous: z.array(TransitionSchema),
})

export const RefusalSchema = z.strictObject({
  refused: HashSchema,
  reason: z.string().max(1000),
})

export const RelayContentSchema = z.union([RequestSchema, RefusalSchema, TransitionSchema])

export const RelayMessageSchema = z.strictObject({
  ephemeral: KeySchema,
  ciphertext: Base64UrlSchema,
})

export type Address = z.infer<typeof AddressSchema>
export type Request = z.infer<typeof RequestSchema>
export type Refusal = z.infer<typeof RefusalSchema>
export type RelayContent = z.infer<typeof RelayContentSchema>
export type RelayMessage = z.infer<typeof RelayMessageSchema>
