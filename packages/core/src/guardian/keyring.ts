import { scryptAsync } from '@noble/hashes/scrypt.js'
import { open, seal } from '../crypto/aead.ts'
import type { SignatureAlgorithm } from '../crypto/algorithm.ts'
import { DEFAULT_ALGORITHM, algorithmOf, keyFromSecret, type Key } from '../crypto/keys.ts'
import { decodeBase64Url, encodeBase64Url } from '../encoding/base64url.ts'
import { fromUtf8, randomBytes, utf8 } from '../encoding/bytes.ts'
import { generateSigner, softwareSigner, type Signer } from '../signing/signer.ts'

/** Holds the guardian key. An HSM or a KMS implements this. */
export interface Keyring {
  current(): Signer
  /** Prepares the next key without activating it. May use another algorithm. */
  next(): Promise<Signer>
  activate(signer: Signer): Promise<void>
}

export function memoryKeyring(algorithm: SignatureAlgorithm = DEFAULT_ALGORITHM): Keyring {
  let signer = generateSigner(algorithm)
  return {
    current: () => signer,
    next: () => Promise.resolve(generateSigner(algorithm)),
    activate(next) {
      signer = next
      return Promise.resolve()
    },
  }
}

/** Durable storage of one opaque, already encrypted value. */
export interface KeyVault {
  load(): Promise<string | null>
  /** Atomic and durable. */
  save(sealed: string): Promise<void>
}

/** Volatile vault for tests and tools. Not durable. */
export class MemoryKeyVault implements KeyVault {
  private sealed: string | null = null

  load(): Promise<string | null> {
    return Promise.resolve(this.sealed)
  }

  save(sealed: string): Promise<void> {
    this.sealed = sealed
    return Promise.resolve()
  }
}

interface KeyEntry {
  key: Key
  secret: string
}

interface VaultContent {
  current: KeyEntry
  next: KeyEntry | null
}

interface SealedVault {
  cost: number
  salt: string
  data: string
}

const DEFAULT_COST = 17
const SALT_LENGTH = 16

export interface SealedKeyringOptions {
  algorithm?: SignatureAlgorithm
  /** scrypt N, as a power of two. */
  cost?: number
}

const newEntry = (algorithm: SignatureAlgorithm): KeyEntry => {
  const secret = algorithm.generateSecret()
  return { key: keyFromSecret(secret, algorithm), secret: encodeBase64Url(secret) }
}

const signerOf = (entry: KeyEntry): Signer =>
  softwareSigner(decodeBase64Url(entry.secret), algorithmOf(entry.key))

/**
 * A software key kept encrypted under a password, in any vault.
 * A pending key is saved before it is used, so a rotation never loses it.
 */
export async function sealedKeyring(
  vault: KeyVault,
  password: string,
  options: SealedKeyringOptions = {},
): Promise<Keyring> {
  const algorithm = options.algorithm ?? DEFAULT_ALGORITHM
  const stored = await vault.load()
  const header = stored ? (JSON.parse(stored) as SealedVault) : null
  const cost = header?.cost ?? options.cost ?? DEFAULT_COST
  const salt = header ? decodeBase64Url(header.salt) : randomBytes(SALT_LENGTH)
  const key = await scryptAsync(utf8(password), salt, { N: 2 ** cost, r: 8, p: 1, dkLen: 32 })

  const save = (content: VaultContent) =>
    vault.save(
      JSON.stringify({
        cost,
        salt: encodeBase64Url(salt),
        data: encodeBase64Url(seal(key, utf8(JSON.stringify(content)))),
      } satisfies SealedVault),
    )

  const unseal = (sealed: SealedVault): VaultContent => {
    try {
      return JSON.parse(fromUtf8(open(key, decodeBase64Url(sealed.data)))) as VaultContent
    } catch {
      throw new Error('wrong password or corrupted vault')
    }
  }

  let content: VaultContent
  if (header) {
    content = unseal(header)
  } else {
    content = { current: newEntry(algorithm), next: null }
    await save(content)
  }
  let signer = signerOf(content.current)

  return {
    current: () => signer,
    async next() {
      const next = newEntry(algorithm)
      content = { ...content, next }
      await save(content)
      return signerOf(next)
    },
    async activate(chosen) {
      const { next } = content
      if (next?.key !== chosen.key) throw new Error('this key was not prepared by this keyring')
      content = { current: next, next: null }
      await save(content)
      signer = chosen
    },
  }
}
