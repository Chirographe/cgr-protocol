import type { GuardianContext } from './context.ts'

/**
 * The writes of section 8. Each takes `{ transition, previous }`, which `Guardian` parses and
 * checks itself.
 */
export function operationRoutes({ app, guardian }: GuardianContext): void {
  app.post('/transitions/validate', (request) => guardian.validate(request.body))
  app.post('/transitions/enter', (request) => guardian.enter(request.body))
  app.post('/transitions/certify', (request) => guardian.certify(request.body))
  app.post('/recovery/notice', (request) => guardian.notice(request.body))
  app.post('/recovery/oppose', (request) => guardian.oppose(request.body))
}
