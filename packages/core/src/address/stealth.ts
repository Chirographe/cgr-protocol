import { FORMAT } from '../constants.ts'
import type { StealthAlgorithm } from '../crypto/algorithm.ts'
import { hashOf, sha256 } from '../crypto/hash.ts'
import { formatKey, isKnownKey, keyBytes, stealthAlgorithmOf, type Key } from '../crypto/keys.ts'
import { concat, utf8 } from '../encoding/bytes.ts'
import type { Address } from '../model/address.ts'
import type { Predicate } from '../model/predicate.ts'
import { keys as keysPredicate } from '../predicate/build.ts'
import { predicateKeys } from '../predicate/shape.ts'
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

const publicKeyOf = (wallet: Wallet, secret: Uint8Array): Key =>
  formatKey(wallet.algorithm, wallet.algorithm.publicKey(secret))

export function walletAddress(wallet: Wallet, relay: string, stealth = true): Address {
  return {
    scan: publicKeyOf(wallet, wallet.scan),
    keys: wallet.spend.map((secret) => publicKeyOf(wallet, secret)),
    threshold: wallet.threshold,
    relay,
    stealth,
  }
}

const tweaks = (algorithm: StealthAlgorithm, shared: Uint8Array, count: number) =>
  Array.from({ length: count }, (_, j) =>
    algorithm.toTweak(sha256(concat(DOMAIN, shared, Uint8Array.of(j)))),
  )

/** Keys `P_j` of an address for one output, given the sender's scalar `r`. */
function addressKeys(address: Address, r: Uint8Array): Key[] | null {
  if (!address.stealth) return address.keys
  const algorithm = stealthAlgorithmOf(address.scan)
  const values = tweaks(
    algorithm,
    algorithm.sharedSecret(r, keyBytes(address.scan)),
    address.keys.length,
  )
  if (values.some((tweak) => tweak === null)) return null
  return address.keys.map((key, j) =>
    formatKey(algorithm, algorithm.tweakPublicKey(keyBytes(key), values[j] as Uint8Array)),
  )
}

/**
 * Section 5: the lock of each address for one output, with the `ephemeral` they share.
 * An address pays `{ threshold, of: [sig P_j] }`.
 */
export function payTo(addresses: Address[]): { locks: Predicate[]; ephemeral?: Key } {
  const stealthy = addresses.find((a) => a.stealth)
  if (!stealthy) return { locks: addresses.map((a) => keysPredicate(a.threshold, a.keys)) }
  const algorithm = stealthAlgorithmOf(stealthy.scan)
  for (;;) {
    const r = algorithm.generateSecret()
    const derived = addresses.map((address) => addressKeys(address, r))
    if (derived.some((keys) => keys === null)) continue
    return {
      locks: addresses.map((a, i) => keysPredicate(a.threshold, derived[i] as Key[])),
      ephemeral: formatKey(algorithm, algorithm.publicKey(r)),
    }
  }
}

/** The wallet's secrets for an output: one-time ones from `ephemeral`, and its plain ones. */
function secretsFor(wallet: Wallet, ephemeral?: Key): Uint8Array[] {
  const { algorithm } = wallet
  // Anyone can post an ephemeral: a bad one means "not for this wallet", not a crash.
  if (!ephemeral || !isKnownKey(ephemeral)) return wallet.spend
  const shared = algorithm.sharedSecret(wallet.scan, keyBytes(ephemeral))
  const values = tweaks(algorithm, shared, wallet.spend.length)
  const oneTime = wallet.spend.flatMap((secret, j) => {
    const tweak = values[j]
    return tweak ? [algorithm.tweakSecret(secret, tweak)] : []
  })
  return [...oneTime, ...wallet.spend]
}

/** Signers of this wallet for the keys of an output. */
export function signersFor(wallet: Wallet, keys: Key[], ephemeral?: Key): Signer[] {
  return secretsFor(wallet, ephemeral)
    .map((secret) => softwareSigner(secret, wallet.algorithm))
    .filter((signer) => keys.includes(signer.key))
}

/** Does this wallet hold at least one key of an output? Used to scan guardians. */
export const holdsAnyKey = (wallet: Wallet, keys: Key[], ephemeral?: Key): boolean =>
  signersFor(wallet, keys, ephemeral).length > 0

/** True if this lock is exactly this wallet's address lock, so that nobody else can spend it. */
export function isOwnLock(wallet: Wallet, lock: Predicate, ephemeral?: Key): boolean {
  const keys = signersFor(wallet, predicateKeys(lock), ephemeral).map((s) => s.key)
  if (keys.length !== wallet.spend.length) return false
  return hashOf(lock) === hashOf(keysPredicate(wallet.threshold, keys))
}
