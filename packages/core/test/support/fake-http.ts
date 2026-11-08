import {
  Mailboxes,
  MemoryMailboxStore,
  ProtocolError,
  Sessions,
  type Fetch,
  type Guardian,
  type Witness,
} from '../../src/index.ts'

/** What one fake host serves. */
export interface Host {
  guardian?: Guardian
  mailboxes?: Mailboxes
  sessions?: Sessions
  witness?: Witness
  witnessName?: string
}

type Handler = (request: Parsed) => Promise<unknown>

interface Parsed {
  method: string
  path: string[]
  query: URLSearchParams
  body: unknown
  session: string | undefined
  host: Required<Pick<Host, 'mailboxes' | 'sessions'>> & Host
}

const CREATED = 201
const NOT_FOUND = 404

const number = (query: URLSearchParams, name: string) => Number(query.get(name))

const need = <T>(value: T | undefined): T => {
  if (value === undefined) throw new ProtocolError('UNKNOWN', 'not served here')
  return value
}

/** Section 10, routed in process: method and path pattern to a handler. */
const ROUTES: [string, string, Handler][] = [
  ['GET', '.well-known/guardian', ({ host }) => need(host.guardian).info()],
  ['GET', 'ledger/head', ({ host }) => need(host.guardian).head()],
  [
    'GET',
    'ledger/lines',
    async ({ host, query }) => ({
      lines: await need(host.guardian).lines(number(query, 'from'), number(query, 'limit')),
    }),
  ],
  [
    'GET',
    'ledger/proof',
    async ({ host, query }) => ({
      path: await need(host.guardian).inclusionProof(number(query, 'line'), number(query, 'size')),
    }),
  ],
  [
    'GET',
    'ledger/consistency',
    async ({ host, query }) => ({
      path: await need(host.guardian).consistencyProof(number(query, 'from'), number(query, 'to')),
    }),
  ],
  ['GET', 'tokens/*/head', ({ host, path }) => need(host.guardian).tokenHead(path[1]!)],
  [
    'GET',
    'outputs/*/claims',
    async ({ host, path }) => ({
      transitions: await need(host.guardian).claims(path[1]!),
    }),
  ],
  ['GET', 'transitions/*', ({ host, path }) => need(host.guardian).transition(path[1]!)],
  ['POST', 'transitions/validate', ({ host, body }) => need(host.guardian).validate(body)],
  ['POST', 'transitions/enter', ({ host, body }) => need(host.guardian).enter(body)],
  ['POST', 'transitions/certify', ({ host, body }) => need(host.guardian).certify(body)],
  [
    'GET',
    'recovery/notices',
    async ({ host }) => ({ notices: await need(host.guardian).notices() }),
  ],
  ['POST', 'recovery/notice', ({ host, body }) => need(host.guardian).notice(body)],
  ['POST', 'recovery/oppose', ({ host, body }) => need(host.guardian).oppose(body)],
  ['POST', 'mailbox/*', ({ host, path, body }) => host.mailboxes.deposit(path[1]!, body)],
  [
    'GET',
    'mailbox/*',
    async ({ host, path, session }) => {
      host.sessions.require(session, path[1]!)
      return { messages: await host.mailboxes.list(path[1]!) }
    },
  ],
  [
    'DELETE',
    'mailbox/*/*',
    async ({ host, path, session }) => {
      host.sessions.require(session, path[1]!)
      await host.mailboxes.remove(path[1]!, Number(path[2]))
      return { ok: true }
    },
  ],
  [
    'POST',
    'auth/challenge',
    ({ host, body }) => Promise.resolve(host.sessions.challenge((body as { key: string }).key)),
  ],
  [
    'POST',
    'auth/response',
    ({ host, body }) =>
      Promise.resolve(host.sessions.respond(body as Parameters<Sessions['respond']>[0])),
  ],
  [
    'GET',
    'owners',
    async ({ host, query }) => ({
      owners: await need(host.guardian).owners(number(query, 'from'), number(query, 'limit')),
    }),
  ],
  [
    'GET',
    'owners/*/outputs',
    async ({ host, path, session }) => {
      host.sessions.require(session, path[1]!)
      return { transitions: await need(host.guardian).outputsOf(path[1]!) }
    },
  ],
  [
    'GET',
    '.well-known/witness',
    ({ host }) =>
      Promise.resolve({ key: need(host.witness).key, name: host.witnessName ?? 'witness' }),
  ],
  ['GET', 'guardians', async ({ host }) => ({ guardians: await need(host.witness).state() })],
  [
    'POST',
    'heads',
    ({ host, body }) => {
      const { guardian, head } = body as { guardian: string; head: never }
      return need(host.witness).submit(guardian, head)
    },
  ],
]

const matches = (pattern: string, path: string[]) => {
  const parts = pattern.split('/')
  return parts.length === path.length && parts.every((part, i) => part === '*' || part === path[i])
}

const json = (status: number, data: unknown) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } })

/** A `fetch` that serves hosts in process, by origin. Errors become `{ error, message }`. */
export function fakeFetch(hosts: Map<string, Host>): Fetch {
  return async (target, init) => {
    const url = new URL(target)
    const served = hosts.get(url.origin)
    if (!served) throw new Error(`unreachable: ${url.origin}`)
    const host = {
      ...served,
      mailboxes: (served.mailboxes ??= new Mailboxes(new MemoryMailboxStore())),
      sessions: (served.sessions ??= new Sessions()),
    }
    const method = init.method ?? 'GET'
    const path = url.pathname.split('/').slice(1).map(decodeURIComponent)
    const route = ROUTES.find(([m, pattern]) => m === method && matches(pattern, path))
    if (!route) return json(NOT_FOUND, { error: 'UNKNOWN', message: 'unknown route' })
    const headers = new Headers(init.headers)
    const request: Parsed = {
      method,
      path,
      query: url.searchParams,
      body: typeof init.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined,
      session: headers.get('authorization')?.replace(/^Bearer /, ''),
      host,
    }
    try {
      const status = method === 'POST' && path[0] === 'mailbox' ? CREATED : 200
      return json(status, await route[2](request))
    } catch (error) {
      if (!(error instanceof ProtocolError)) throw error
      const { code, message, details, status } = error
      return json(status, { ...details, error: code, message })
    }
  }
}
