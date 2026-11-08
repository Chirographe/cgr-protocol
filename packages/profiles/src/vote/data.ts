import { UrlSchema } from '@chirographe/core'
import { z } from 'zod'

export const VOTE = 'vote/1'

export const QUESTION_LENGTH = 160
export const OPTION_LENGTH = 40
export const MIN_OPTIONS = 2
export const MAX_OPTIONS = 8

/** What an election says. Its roll and close date live in its predicates. */
export const ElectionDataSchema = z.strictObject({
  question: z.string().min(1).max(QUESTION_LENGTH),
  options: z.array(z.string().min(1).max(OPTION_LENGTH)).min(MIN_OPTIONS).max(MAX_OPTIONS),
  /** Where the roll is published, as `{ commitments }`. */
  roll: UrlSchema,
})

export const BallotDataSchema = z.strictObject({ choice: z.number().int().nonnegative() })

/** The published roll: every registered commitment, in order. */
export const RollSchema = z.strictObject({
  commitments: z.array(z.string().regex(/^(0|[1-9][0-9]*)$/)).min(1),
})

export type ElectionData = z.infer<typeof ElectionDataSchema>
export type BallotData = z.infer<typeof BallotDataSchema>
export type Roll = z.infer<typeof RollSchema>
