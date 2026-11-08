import type { Hash } from '../crypto/hash.ts'
import type { Key } from '../crypto/keys.ts'
import type { GuardianApi, GuardianInfo } from '../model/api.ts'
import type { Head, Line, Notice, OwnerEntry, TokenHead } from '../model/ledger.ts'
import type { Transition, Vote } from '../model/transition.ts'
import { signRotation } from '../signing/rotations.ts'
import { hashOf } from '../crypto/hash.ts'
import { GuardianCore, type GuardianConfig } from './core.ts'
import { certify } from './operations/certify.ts'
import { enter } from './operations/enter.ts'
import { notice } from './operations/notice.ts'
import { oppose } from './operations/oppose.ts'
import { validate } from './operations/validate.ts'
import type { Policy } from './policy.ts'
import { GuardianReads } from './reads.ts'

export type { GuardianConfig } from './core.ts'

/**
 * The trusted third party: keeps a ledger, evaluates predicates and votes (section 8).
 * Write operations take untrusted input and parse it themselves.
 */
export class Guardian implements GuardianApi {
  private readonly reads: GuardianReads

  private constructor(private readonly core: GuardianCore) {
    this.reads = new GuardianReads(core)
  }

  /** Starts a guardian. It locks itself if its ledger no longer matches its published head. */
  static async open(config: GuardianConfig): Promise<Guardian> {
    const core = new GuardianCore(config)
    await core.open()
    return new Guardian(core)
  }

  get key(): Key {
    return this.core.key
  }

  get url(): string {
    return this.core.url
  }

  get locked(): boolean {
    return this.core.locked
  }

  setPolicy(policy: Policy): void {
    this.core.policy = policy
  }

  head = (): Promise<Head> => this.core.head()
  info = (): Promise<GuardianInfo> => this.reads.info()
  lines = (from: number, limit: number): Promise<Line[]> => this.reads.lines(from, limit)
  inclusionProof = (line: number, size: number) => this.reads.inclusionProof(line, size)
  consistencyProof = (from: number, to: number) => this.reads.consistencyProof(from, to)
  tokenHead = (token: Hash): Promise<TokenHead> => this.reads.tokenHead(token)
  transition = (hash: Hash): Promise<Transition> => this.reads.transition(hash)
  claims = (output: Hash): Promise<Transition[]> => this.reads.claims(output)
  notices = (): Promise<Notice[]> => this.reads.notices()
  owners = (from: number, limit: number): Promise<OwnerEntry[]> => this.reads.owners(from, limit)
  outputsOf = (key: Key): Promise<Transition[]> => this.reads.outputsOf(key)

  validate = (data: unknown): Promise<Transition> => validate(this.core, data)
  enter = (data: unknown): Promise<{ incoming_guardian: Vote }> => enter(this.core, data)
  certify = (data: unknown): Promise<{ line: number | null }> => certify(this.core, data)
  notice = (data: unknown): Promise<{ ends_at: string; line: number }> => notice(this.core, data)
  oppose = (data: unknown): Promise<{ line: number }> => oppose(this.core, data)

  /** Section 8: signs a rotation with both keys, records it, and switches key. */
  async rotate(): Promise<void> {
    const { keyring } = this.core
    const next = await keyring.next()
    const rotation = await signRotation(keyring.current(), next)
    await this.core.write(
      async (tx) => {
        await tx.saveRotation(rotation)
        await this.core.addLine(tx, { type: 'rotation', hash: hashOf(rotation), spent: [] })
      },
      () => keyring.activate(next),
    )
  }
}
