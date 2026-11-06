import { FORMAT } from '../constants.ts'
import { open, seal } from '../crypto/aead.ts'
import { sha256 } from '../crypto/hash.ts'
import { formatKey, keyBytes, stealthAlgorithmOf, type Key } from '../crypto/keys.ts'
import { decodeBase64Url, encodeBase64Url } from '../encoding/base64url.ts'
import { concat, fromUtf8, utf8 } from '../encoding/bytes.ts'
import { RelayContentSchema, type RelayContent, type RelayMessage } from '../model/address.ts'
import type { Wallet } from './stealth.ts'

const DOMAIN = utf8(`${FORMAT}|mailbox|`)

const relayKey = (shared: Uint8Array) => sha256(concat(DOMAIN, shared))

/** Encrypts a message to the owner of a `scan` key. */
export function sealMessage(scan: Key, content: RelayContent): RelayMessage {
  const algorithm = stealthAlgorithmOf(scan)
  const r = algorithm.generateSecret()
  const key = relayKey(algorithm.sharedSecret(r, keyBytes(scan)))
  return {
    ephemeral: formatKey(algorithm, algorithm.publicKey(r)),
    ciphertext: encodeBase64Url(seal(key, utf8(JSON.stringify(content)))),
  }
}

export function openMessage(wallet: Wallet, message: RelayMessage): RelayContent {
  const key = relayKey(wallet.algorithm.sharedSecret(wallet.scan, keyBytes(message.ephemeral)))
  const content = open(key, decodeBase64Url(message.ciphertext))
  return RelayContentSchema.parse(JSON.parse(fromUtf8(content)))
}
