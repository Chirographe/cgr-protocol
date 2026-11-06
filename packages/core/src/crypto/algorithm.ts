/**
 * What the protocol needs from a signature scheme. Keys and signatures are opaque bytes:
 * nothing outside an implementation of this interface knows about a curve.
 */
export interface SignatureAlgorithm {
  /** Key prefix on the wire, as in `p256:…`. */
  readonly id: string
  generateSecret(): Uint8Array
  publicKey(secret: Uint8Array): Uint8Array
  sign(message: Uint8Array, secret: Uint8Array): Uint8Array
  verify(signature: Uint8Array, message: Uint8Array, publicKey: Uint8Array): boolean
}

/** A scheme that also supports one-time owners and relay encryption (section 5). */
export interface StealthAlgorithm extends SignatureAlgorithm {
  /** Shared point coordinate between a secret and a public key. */
  sharedSecret(secret: Uint8Array, publicKey: Uint8Array): Uint8Array
  /** Maps a digest to a tweak, or `null` if it reduces to zero. */
  toTweak(digest: Uint8Array): Uint8Array | null
  tweakPublicKey(publicKey: Uint8Array, tweak: Uint8Array): Uint8Array
  tweakSecret(secret: Uint8Array, tweak: Uint8Array): Uint8Array
}

export const supportsStealth = (algorithm: SignatureAlgorithm): algorithm is StealthAlgorithm =>
  'sharedSecret' in algorithm
