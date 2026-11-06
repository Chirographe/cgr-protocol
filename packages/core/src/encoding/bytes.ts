import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js'

export const toHex = bytesToHex
export const fromHex = hexToBytes

export const utf8 = (text: string): Uint8Array => new TextEncoder().encode(text)
export const fromUtf8 = (bytes: Uint8Array): string => new TextDecoder().decode(bytes)

export function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((total, part) => total + part.length, 0))
  let offset = 0
  for (const part of parts) {
    out.set(part, offset)
    offset += part.length
  }
  return out
}

export function equalBytes(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && a.every((byte, i) => byte === b[i])
}

export const randomBytes = (length: number): Uint8Array =>
  crypto.getRandomValues(new Uint8Array(length))
