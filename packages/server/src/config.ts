import { OPEN_POLICY, type Policy } from '@chirographe/core'
import { DEFAULT_REQUESTS_PER_MINUTE } from './guardian.ts'

type Env = Record<string, string | undefined>

function required(env: Env, name: string): string {
  const value = env[name]
  if (!value) throw new Error(`missing environment variable: ${name}`)
  return value
}

const list = (value: string | undefined): string[] =>
  (value ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)

function integer(env: Env, name: string, fallback: number): number {
  const value = Number(env[name] ?? fallback)
  if (!Number.isInteger(value) || value <= 0) throw new Error(`invalid ${name}: ${env[name]}`)
  return value
}

const keysOrAnyone = (value: string | undefined) => {
  const keys = list(value)
  return keys.length > 0 ? keys : null
}

interface CommonConfig {
  name: string
  password: string
  host: string
  port: number
  corsOrigins: string[]
  trustProxy: boolean
}

const DEFAULT_HOST = '127.0.0.1'
const DEFAULT_GUARDIAN_PORT = 4001
const DEFAULT_WITNESS_PORT = 4100
const DEFAULT_WITNESS_INTERVAL_SECONDS = 30

const common = (env: Env, prefix: string, defaultPort: number): CommonConfig => ({
  name: required(env, `${prefix}_NAME`),
  password: required(env, `${prefix}_PASSWORD`),
  host: env.HOST ?? DEFAULT_HOST,
  port: integer(env, 'PORT', defaultPort),
  corsOrigins: list(env.CORS_ORIGINS),
  trustProxy: env.TRUST_PROXY === 'true',
})

export interface GuardianServerConfig extends CommonConfig {
  /** Public URL of this guardian, as written in groups. */
  url: string
  policy: Policy
  requestsPerMinute: number
}

export const readGuardianConfig = (env: Env): GuardianServerConfig => ({
  ...common(env, 'GUARDIAN', DEFAULT_GUARDIAN_PORT),
  url: required(env, 'GUARDIAN_URL'),
  policy: {
    issuers: keysOrAnyone(env.GUARDIAN_ISSUERS),
    origins: keysOrAnyone(env.GUARDIAN_ORIGINS),
    maxValiditySeconds: integer(
      env,
      'GUARDIAN_MAX_VALIDITY_SECONDS',
      OPEN_POLICY.maxValiditySeconds,
    ),
  },
  requestsPerMinute: integer(env, 'GUARDIAN_REQUESTS_PER_MINUTE', DEFAULT_REQUESTS_PER_MINUTE),
})

export interface WitnessServerConfig extends CommonConfig {
  guardians: string[]
  intervalSeconds: number
}

export const readWitnessConfig = (env: Env): WitnessServerConfig => ({
  ...common(env, 'WITNESS', DEFAULT_WITNESS_PORT),
  guardians: list(env.WITNESS_GUARDIANS),
  intervalSeconds: integer(env, 'WITNESS_INTERVAL_SECONDS', DEFAULT_WITNESS_INTERVAL_SECONDS),
})
