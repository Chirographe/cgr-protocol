import { describe, expect, it } from 'vitest'
import { decodeBase64Url, encodeBase64Url } from '../src/encoding/base64url.ts'
import { canonicalJson } from '../src/encoding/canonical.ts'
import { concat, equalBytes, fromUtf8, utf8 } from '../src/encoding/bytes.ts'

describe('base64url', () => {
  it('round-trips without padding', () => {
    const bytes = Uint8Array.of(251, 255, 0, 1)
    expect(encodeBase64Url(bytes)).toBe('-_8AAQ')
    expect(decodeBase64Url('-_8AAQ')).toEqual(bytes)
  })

  it('refuses other alphabets', () => {
    expect(() => decodeBase64Url('a+b/')).toThrow('invalid base64url')
  })
})

describe('canonical JSON (RFC 8785)', () => {
  it('sorts keys by code unit and normalizes numbers', () => {
    expect(canonicalJson({ b: 1e3, a: [true, null, 'é'], c: { z: 1, y: 2 } })).toBe(
      '{"a":[true,null,"é"],"b":1000,"c":{"y":2,"z":1}}',
    )
  })

  it('refuses values without a canonical form', () => {
    expect(() => canonicalJson(undefined)).toThrow('no canonical form')
  })
})

describe('bytes', () => {
  it('concatenates and compares', () => {
    expect(concat(utf8('a'), utf8('b'))).toEqual(utf8('ab'))
    expect(fromUtf8(utf8('é'))).toBe('é')
    expect(equalBytes(utf8('a'), utf8('b'))).toBe(false)
  })
})
