import { parse } from '../http.ts'
import type { GuardianContext } from './context.ts'
import {
  ConsistencyQuery,
  HashParams,
  InclusionQuery,
  OutputParams,
  Page,
  TokenParams,
} from './queries.ts'

/** The public reads of section 10. */
export function readRoutes({ app, guardian }: GuardianContext): void {
  app.get('/.well-known/guardian', () => guardian.info())

  app.get('/ledger/head', () => guardian.head())

  app.get('/ledger/lines', async (request) => {
    const { from, limit } = parse(Page, request.query)
    return { lines: await guardian.lines(from, limit) }
  })

  app.get('/ledger/proof', async (request) => {
    const { line, size } = parse(InclusionQuery, request.query)
    return { path: await guardian.inclusionProof(line, size) }
  })

  app.get('/ledger/consistency', async (request) => {
    const { from, to } = parse(ConsistencyQuery, request.query)
    return { path: await guardian.consistencyProof(from, to) }
  })

  app.get('/tokens/:token/head', (request) =>
    guardian.tokenHead(parse(TokenParams, request.params).token),
  )

  app.get('/transitions/:hash', (request) =>
    guardian.transition(parse(HashParams, request.params).hash),
  )

  app.get('/outputs/:output/claims', async (request) => {
    const { output } = parse(OutputParams, request.params)
    return { transitions: await guardian.claims(output) }
  })

  app.get('/recovery/notices', async () => ({ notices: await guardian.notices() }))
}
