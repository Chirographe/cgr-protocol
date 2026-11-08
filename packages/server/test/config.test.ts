import { describe, expect, it, vi } from 'vitest'
import { OPEN_POLICY } from '@chirographe/core'
import { closeOnSignal, rateLimit, readGuardianConfig, readWitnessConfig } from '../src/index.ts'
import { serve } from './support.ts'

const MINUTE_MS = 60_000

describe('configuration', () => {
  const env = {
    GUARDIAN_NAME: 'x',
    GUARDIAN_URL: 'https://x.test',
    GUARDIAN_PASSWORD: 'secret',
  }

  it('reads a guardian configuration and its policy', () => {
    const config = readGuardianConfig({
      ...env,
      PORT: '5000',
      CORS_ORIGINS: 'https://a.test, https://b.test',
      GUARDIAN_ISSUERS: 'p256:AAAA, p256:BBBB',
      GUARDIAN_MAX_VALIDITY_SECONDS: '3600',
      TRUST_PROXY: 'true',
    })
    expect(config).toMatchObject({
      host: '127.0.0.1',
      port: 5000,
      corsOrigins: ['https://a.test', 'https://b.test'],
      trustProxy: true,
      requestsPerMinute: 60,
      policy: { issuers: ['p256:AAAA', 'p256:BBBB'], origins: null, maxValiditySeconds: 3600 },
    })
  })

  it('opens the policy by default', () => {
    expect(readGuardianConfig({ ...env, GUARDIAN_ORIGINS: 'p256:CCCC' }).policy).toEqual({
      ...OPEN_POLICY,
      origins: ['p256:CCCC'],
    })
  })

  it('refuses a missing password or an invalid number', () => {
    expect(() => readGuardianConfig({ ...env, GUARDIAN_PASSWORD: '' })).toThrow('GUARDIAN_PASSWORD')
    expect(() => readGuardianConfig({ ...env, PORT: 'many' })).toThrow('invalid PORT')
    expect(() => readGuardianConfig({ ...env, GUARDIAN_MAX_VALIDITY_SECONDS: '-1' })).toThrow(
      'GUARDIAN_MAX_VALIDITY_SECONDS',
    )
  })

  it('reads a witness configuration', () => {
    const config = readWitnessConfig({
      WITNESS_NAME: 'w',
      WITNESS_PASSWORD: 'secret',
      WITNESS_GUARDIANS: 'https://x.test,https://y.test',
    })
    expect(config).toMatchObject({
      port: 4100,
      guardians: ['https://x.test', 'https://y.test'],
      intervalSeconds: 30,
    })
  })
})

describe('rate limit', () => {
  it('starts over each minute and counts clients apart', () => {
    let now = 0
    const limit = rateLimit(1, () => now)
    limit('a')
    limit('b')
    expect(() => limit('a')).toThrow('too many requests')
    now = MINUTE_MS
    expect(() => limit('a')).not.toThrow()
  })
})

describe('shutdown', () => {
  it('closes the server on the signals of a process manager', async () => {
    const { app } = await serve()
    const handlers = new Map<string, () => void>()
    const once = vi.spyOn(process, 'once').mockImplementation(((
      signal: string,
      handler: () => void,
    ) => {
      handlers.set(signal, handler)
      return process
    }) as typeof process.once)
    closeOnSignal(app)
    once.mockRestore()
    expect([...handlers.keys()]).toEqual(['SIGINT', 'SIGTERM'])
    handlers.get('SIGTERM')?.()
    await vi.waitFor(() => expect(app.server.listening).toBe(false))
  })
})
