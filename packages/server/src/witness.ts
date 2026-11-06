import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { HeadSchema, KeySchema, type Witness } from '@chirographe/core'
import { createHttpServer, parse, type HttpOptions } from './http.ts'

const HeadsBody = z.strictObject({ guardian: KeySchema, head: HeadSchema })

export interface WitnessServerOptions extends HttpOptions {
  witness: Witness
  name: string
}

/** The witness routes of section 10. */
export async function createWitnessServer(options: WitnessServerOptions): Promise<FastifyInstance> {
  const { witness, name } = options
  const app = await createHttpServer(options)

  app.get('/.well-known/witness', () => Promise.resolve({ key: witness.key, name }))

  app.get('/guardians', async () => ({ guardians: await witness.state() }))

  app.post('/heads', (request) => {
    const { guardian, head } = parse(HeadsBody, request.body)
    return witness.submit(guardian, head)
  })

  return app
}
