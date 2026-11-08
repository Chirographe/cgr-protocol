import { hashToBytes, toHex, type Hash } from '@chirographe/core'

/** A `sha256:` hash read as a big-endian integer, in decimal (section 3). */
export const hashAsInteger = (hash: Hash): string =>
  BigInt(`0x${toHex(hashToBytes(hash))}`).toString()
