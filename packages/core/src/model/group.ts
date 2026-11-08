import { z } from 'zod'
import { LIMITS } from '../constants.ts'
import { KeySchema, UrlSchema } from './primitives.ts'

const distinct = (values: string[]) => new Set(values).size === values.length

/** Failures a group of n tolerates. */
export const toleratedFaults = (n: number): number => Math.floor((n - 1) / 3)

/** Smallest safe threshold: two quorums overlap on at least one honest member. */
export const minimumThreshold = (n: number): number => Math.ceil((n + toleratedFaults(n) + 1) / 2)

export const MemberSchema = z.strictObject({ key: KeySchema, url: UrlSchema })

export const GroupSchema = z
  .strictObject({
    members: z.array(MemberSchema).min(1).max(LIMITS.groupMembers),
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

export type Member = z.infer<typeof MemberSchema>
export type Group = z.infer<typeof GroupSchema>
export type Recovery = z.infer<typeof RecoverySchema>
