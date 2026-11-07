import { FORMAT } from '../constants.ts'
import type { StealthAlgorithm } from '../crypto/algorithm.ts'
import { sha256 } from '../crypto/hash.ts'
import { formatKey, isKnownKey, keyBytes, stealthAlgorithmOf, type Key } from '../crypto/keys.ts'
import { concat, utf8 } from '../encoding/bytes.ts'
import type { Address } from '../model/address.ts'
import type { Owner } from '../model/parties.ts'
import type { State } from '../model/token.ts'
import { softwareSigner, type Signer } from '../signing/signer.ts'

const DOMAIN = utf8(`${FORMAT}|stealth|`)

/** Private keys of an address. They never leave the wallet. */
export interface Wallet {
  algorithm: StealthAlgorithm
  scan: Uint8Array
  spend: Uint8Array[]
  threshold: number
}

export function generateWallet(algorithm: StealthAlgorithm, keyCount = 1, threshold = 1): Wallet {
  return {
    algorithm,
    scan: algorithm.generateSecret(),
    spend: Array.from({ length: keyCount }, () => algorithm.generateSecret()),
    threshold,
  }
}

export function walletAddress(wallet: Wallet, relay: string, stealth = true): Address {
  const key = (secret: Uint8Array) =>
    formatKey(wallet.algorithm, wallet.algorithm.publicKey(secret))
  return {
    scan: key(wallet.scan),
    keys: wallet.spend.map(key),
    threshold: wallet.threshold,
    relay,
    stealth,
  }
}

function tweaks(algorithm: StealthAlgorithm, shared: Uint8Array, count: number) {
  return Array.from({ length: count }, (_, j) =>
    algorithm.toTweak(sha256(concat(DOMAIN, shared, Uint8Array.of(j)))),
  )
}

/** Derives a fresh owner from an address (section 5). */
export function deriveOwner(address: Address): { owner: Owner; ephemeral?: Key } {
  const owner = { keys: address.keys, threshold: address.threshold }
  if (!address.stealth) return { owner }

  const algorithm = stealthAlgorithmOf(address.scan)
  for (;;) {
    const r = algorithm.generateSecret()
    const shared = algorithm.sharedSecret(r, keyBytes(address.scan))
    const values = tweaks(algorithm, shared, address.keys.length)
    if (values.some((tweak) => tweak === null)) continue
    return {
      owner: {
        keys: address.keys.map((key, j) =>
          formatKey(algorithm, algorithm.tweakPublicKey(keyBytes(key), values[j] as Uint8Array)),
        ),
        threshold: address.threshold,
      },
      ephemeral: formatKey(algorithm, algorithm.publicKey(r)),
    }
  }
}

/** The one-time secrets of a state, or `null` if this wallet does not own it. */
function oneTimeSecrets(wallet: Wallet, owner: Owner, ephemeral: Key): Uint8Array[] | null {
  const { algorithm } = wallet
  // Anyone can post an ephemeral: a bad one means "not for this wallet", not a crash.
  if (!isKnownKey(ephemeral)) return null
  const shared = algorithm.sharedSecret(wallet.scan, keyBytes(ephemeral))
  const values = tweaks(algorithm, shared, wallet.spend.length)
  const secrets = wallet.spend.map((secret, j) => {
    const tweak = values[j]
    return tweak ? algorithm.tweakSecret(secret, tweak) : null
  })
  if (secrets.some((secret) => secret === null)) return null
  const keys = (secrets as Uint8Array[]).map((secret) =>
    formatKey(algorithm, algorithm.publicKey(secret)),
  )
  const same = keys.length === owner.keys.length && keys.every((k, j) => k === owner.keys[j])
  return same ? (secrets as Uint8Array[]) : null
}

/** True if this wallet can spend a state with this owner. */
export function owns(wallet: Wallet, owner: Owner, ephemeral?: Key): boolean {
  return signersFor(wallet, owner, ephemeral).length >= owner.threshold
}

/**
 * True if this owner is this wallet and nobody else, which `owns` does not say: a wallet can
 * reach the threshold of an owner that has other keys, and those keys could spend too.
 */
export function isSoleOwner(wallet: Wallet, owner: Owner, ephemeral?: Key): boolean {
  if (owner.threshold !== wallet.threshold) return false
  const signers = signersFor(wallet, owner, ephemeral)
  return signers.length === owner.keys.length && signers.length === wallet.spend.length
}

/** Signers for an owner held by this wallet, empty if it holds none. */
export function signersFor(wallet: Wallet, owner: Owner, ephemeral?: Key): Signer[] {
  const { algorithm } = wallet
  if (ephemeral) {
    const secrets = oneTimeSecrets(wallet, owner, ephemeral)
    return secrets ? secrets.map((secret) => softwareSigner(secret, algorithm)) : []
  }
  return wallet.spend
    .map((secret) => softwareSigner(secret, algorithm))
    .filter((signer) => owner.keys.includes(signer.key))
}

export const signersForState = (wallet: Wallet, state: State): Signer[] =>
  signersFor(wallet, state.owner, state.ephemeral)
