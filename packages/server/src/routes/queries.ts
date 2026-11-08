import { z } from 'zod'
import { Base64UrlSchema, HashSchema, KeySchema } from '@chirographe/core'

/** Longest page of `/ledger/lines` and `/owners`. */
export const MAX_PAGE = 500

const Integer = z.coerce.number().int()

export const Page = z.object({
  from: Integer.positive().default(1),
  limit: Integer.positive().max(MAX_PAGE).default(MAX_PAGE),
})

export const InclusionQuery = z
  .object({ line: Integer.positive(), size: Integer.positive() })
  .refine(({ line, size }) => line <= size, 'line is past size')

export const ConsistencyQuery = z
  .object({ from: Integer.nonnegative(), to: Integer.nonnegative() })
  .refine(({ from, to }) => from <= to, 'from is past to')

export const TokenParams = z.object({ token: HashSchema })
export const HashParams = z.object({ hash: HashSchema })
export const OutputParams = z.object({ output: HashSchema })
export const ScanParams = z.object({ scan: KeySchema })
export const MessageParams = ScanParams.extend({ id: Integer })
export const OwnerParams = z.object({ key: KeySchema })

export const ChallengeBody = z.strictObject({ key: KeySchema })
export const ResponseBody = z.strictObject({
  key: KeySchema,
  challenge: Base64UrlSchema,
  signature: Base64UrlSchema,
})
