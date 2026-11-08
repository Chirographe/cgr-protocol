import { z } from 'zod'
import { LIMITS } from '../constants.ts'
import { notAuthorized, parseWith } from '../errors.ts'
import type { Submission } from '../model/api.ts'
import { TransitionSchema, type Transition } from '../model/transition.ts'
import { hasQuorum } from '../transition/validity.ts'

const SubmissionSchema = z.strictObject({
  transition: TransitionSchema,
  previous: z.array(TransitionSchema).max(LIMITS.inputs),
})

export const parseSubmission = (data: unknown): Submission =>
  parseWith(SubmissionSchema, data, 'submission')

/** Previous transitions are final: their votes vouch for them. */
export function requireFinal(previous: Transition[]): void {
  if (!previous.every(hasQuorum)) throw notAuthorized('a previous transition is not final')
}
