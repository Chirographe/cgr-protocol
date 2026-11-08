import { z } from 'zod'
import type { Key } from '../crypto/keys.ts'
import type { Head } from '../model/ledger.ts'
import { KeySchema } from '../model/primitives.ts'
import {
  FraudProofSchema,
  WitnessGuardianSchema,
  type FraudProof,
  type WitnessGuardian,
} from '../model/responses.ts'
import { Transport, type HttpOptions } from './transport.ts'

/** A witness reached over HTTP. */
export class HttpWitness {
  private readonly http: Transport

  constructor(url: string, options: HttpOptions = {}) {
    this.http = new Transport(url, options)
  }

  info(): Promise<{ key: Key; name: string }> {
    return this.http.get(
      z.strictObject({ key: KeySchema, name: z.string() }),
      '/.well-known/witness',
    )
  }

  async guardians(): Promise<WitnessGuardian[]> {
    const schema = z.strictObject({ guardians: z.array(WitnessGuardianSchema) })
    return (await this.http.get(schema, '/guardians')).guardians
  }

  submitHead(guardian: Key, head: Head): Promise<{ ok: boolean; fraud: FraudProof | null }> {
    const schema = z.strictObject({ ok: z.boolean(), fraud: FraudProofSchema.nullable() })
    return this.http.post(schema, '/heads', { guardian, head })
  }
}
