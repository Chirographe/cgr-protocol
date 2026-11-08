import { registerScheme } from '@chirographe/core'
import { semaphoreScheme } from './scheme.ts'

export * from './constants.ts'
export * from './members.ts'
export * from './nullifier.ts'
export * from './prove.ts'
export * from './scheme.ts'

/** Lets `member` predicates of the `semaphore/4` scheme be verified in this process. */
export const registerSemaphore = (): void => registerScheme(semaphoreScheme)
