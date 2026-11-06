import { FORMAT } from '../constants.ts'
import { utf8 } from '../encoding/bytes.ts'
import type { Hash } from '../crypto/hash.ts'
import type { Key } from '../crypto/keys.ts'

const message = (...parts: (string | number)[]): Uint8Array => utf8([FORMAT, ...parts].join('|'))

export const guardianMessage = (stateHash: Hash, line: number, lineHash: Hash): Uint8Array =>
  message('guardian', stateHash, line, lineHash)

export const entryMessage = (stateHash: Hash): Uint8Array => message('entry', stateHash)

export const headMessage = (n: number, root: Hash): Uint8Array => message('head', n, root)

export const rotationMessage = (previous: Key, next: Key): Uint8Array =>
  message('rotation', previous, next)

export const witnessMessage = (guardian: Key, n: number, root: Hash): Uint8Array =>
  message('witness', guardian, n, root)
