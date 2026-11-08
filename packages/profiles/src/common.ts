import {
  HashSchema,
  hashOf,
  randomBytes,
  sha256,
  toHex,
  type Hash,
  type Output,
  type Transition,
} from '@chirographe/core'
import { z } from 'zod'

export const LABEL_LENGTH = 120
const SALT_BYTES = 16

export const LabelSchema = z.string().min(1).max(LABEL_LENGTH)

/** What a token says about a document it does not hold: a label and a salted digest. */
export const DocumentDataSchema = z.strictObject({ label: LabelSchema, digest: HashSchema })
export type DocumentData = z.infer<typeof DocumentDataSchema>

/** A fresh salt, shared off-protocol with whoever must check the document. */
export const newSalt = (): string => toHex(randomBytes(SALT_BYTES))

/** The salt stops anyone from confirming a guessed document from its digest. */
export const digestOf = (content: Uint8Array, salt: string): Hash =>
  hashOf({ salt, sha256: toHex(sha256(content)) })

/** The data of an output under a profile's schema, or `null` if it does not match. */
export function dataOf<T>(output: Output, schema: z.ZodType<T>): T | null {
  const parsed = schema.safeParse(output.data)
  return parsed.success ? parsed.data : null
}

/** The only output of a transition, if it has exactly one. */
export const soleOutput = (transition: Transition): Output | null =>
  transition.body.outputs.length === 1 ? transition.body.outputs[0]! : null
