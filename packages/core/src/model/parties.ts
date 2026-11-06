import { z } from 'zod'
import { KeySchema } from './primitives.ts'

const MAX_MEMBERS = 31

const distinct = (keys: string[]) => new Set(keys).size === keys.length

/** Failures a group of n tolerates. */
export const toleratedFaults = (n: number): number => Math.floor((n - 1) / 3)

/** Smallest safe threshold: two quorums overlap on at least one honest member. */
export const minimumThreshold = (n: number): number => Math.ceil((n + toleratedFaults(n) + 1) / 2)

export const OwnerSchema = z
  .strictObject({
    keys: z.array(KeySchema).min(1).max(MAX_MEMBERS),
    threshold: z.number().int().positive(),
  })
  .refine(({ keys, threshold }) => threshold <= keys.length, 'threshold above key count')
  .refine(({ keys }) => distinct(keys), 'duplicate key')

export const MemberSchema = z.strictObject({ key: KeySchema, url: z.url() })

export const GroupSchema = z
  .strictObject({
    members: z.array(MemberSchema).min(1).max(MAX_MEMBERS),
    threshold: z.number().int().positive(),
  })
  .refine(
    ({ members, threshold }) =>
      threshold <= members.length && threshold >= minimumThreshold(members.length),
    'unsafe threshold',
  )
  .refine(({ members }) => distinct(members.map((m) => m.key)), 'duplicate member')

export const RecoverySchema = z.strictObject({
  group: GroupSchema,
  delay_seconds: z.number().int().positive(),
})

export type Owner = z.infer<typeof OwnerSchema>
export type Group = z.infer<typeof GroupSchema>
export type Member = z.infer<typeof MemberSchema>
export type Recovery = z.infer<typeof RecoverySchema>

/** A single key as an owner. */
export const soleOwner = (key: string): Owner => ({ keys: [key], threshold: 1 })
