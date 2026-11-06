import { z } from 'zod'
import { isKnownKey } from '../crypto/keys.ts'

export const KeySchema = z.string().refine(isKnownKey, 'unknown key')
export const HashSchema = z.string().regex(/^sha256:[0-9a-f]{64}$/, 'invalid hash')
export const DateSchema = z.iso.datetime()
export const Base64UrlSchema = z.string().regex(/^[A-Za-z0-9_-]+$/, 'invalid base64url')
