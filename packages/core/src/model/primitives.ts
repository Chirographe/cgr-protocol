import { z } from 'zod'
import { LIMITS } from '../constants.ts'
import { isKnownKey } from '../crypto/keys.ts'
import { utf8 } from '../encoding/bytes.ts'
import { canonicalJson } from '../encoding/canonical.ts'

export const KeySchema = z.string().refine(isKnownKey, 'unknown key')
export const HashSchema = z.string().regex(/^sha256:[0-9a-f]{64}$/, 'invalid hash')
export const DateSchema = z.iso.datetime()
export const Base64UrlSchema = z.string().regex(/^[A-Za-z0-9_-]+$/, 'invalid base64url')
/**
 * An http(s) URL, taken as written: a schema that normalized it would change the hash of
 * the object holding it.
 */
export const UrlSchema = z
  .string()
  .max(2048)
  .refine((text) => /^https?:\/\/[^\s]+$/.test(text) && URL.canParse(text), 'invalid url')

export const NonceSchema = z
  .string()
  .regex(new RegExp(`^[0-9a-f]{${LIMITS.nonceBytes * 2}}$`), 'invalid nonce')

const canonicalSize = (value: unknown): number => {
  try {
    return utf8(canonicalJson(value)).length
  } catch {
    return Infinity
  }
}

/** Any JSON value of at most `LIMITS.valueBytes` canonical bytes. */
export const ValueSchema = z
  .json()
  .refine((value) => canonicalSize(value) <= LIMITS.valueBytes, 'value too large')

export type Value = z.infer<typeof ValueSchema>
