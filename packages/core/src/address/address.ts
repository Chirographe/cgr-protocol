import { decodeBase64Url, encodeBase64Url } from '../encoding/base64url.ts'
import { fromUtf8, utf8 } from '../encoding/bytes.ts'
import { canonicalJson } from '../encoding/canonical.ts'
import { AddressSchema, type Address } from '../model/address.ts'

const PREFIX = 'cgr:'

export const encodeAddress = (address: Address): string =>
  `${PREFIX}${encodeBase64Url(utf8(canonicalJson(address)))}`

export function decodeAddress(text: string): Address {
  if (!text.startsWith(PREFIX)) throw new Error('invalid address')
  return AddressSchema.parse(JSON.parse(fromUtf8(decodeBase64Url(text.slice(PREFIX.length)))))
}
