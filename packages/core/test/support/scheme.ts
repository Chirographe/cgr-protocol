import { hashOf, registerScheme, type MembershipScheme } from '../../src/index.ts'

/** A stand-in for a real proof system: the "proof" reveals the secret. Tests only. */
export const TEST_SCHEME = 'test/1'

const field = (value: unknown) => BigInt(`0x${hashOf(value).slice(7, 23)}`).toString()

export const commitmentOf = (secret: string) => field({ commitment: secret })
export const rootOf = (commitments: string[]) => field({ root: commitments })
export const nullifierOf = (secret: string, scope: string) => field({ secret, scope })

export const testScheme: MembershipScheme = {
  id: TEST_SCHEME,
  verify({ root, nullifier, scope, message, proof }) {
    const { secret, members, signal } = proof as {
      secret: string
      members: string[]
      signal: string
    }
    return Promise.resolve(
      rootOf(members) === root &&
        members.includes(commitmentOf(secret)) &&
        nullifierOf(secret, scope) === nullifier &&
        signal === message,
    )
  },
}

registerScheme(testScheme)
