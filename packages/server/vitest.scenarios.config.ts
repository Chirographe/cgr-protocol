import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

const scenarios = ['agility', 'guardian', 'recovery', 'rotation', 'stealth', 'token', 'witness']

/**
 * Runs the scenarios of `core`, unchanged, against real HTTP servers on real storage:
 * only the network they run on is swapped.
 */
export default defineConfig({
  root: fileURLToPath(new URL('..', import.meta.url)),
  resolve: {
    alias: [
      {
        find: /^\.\/network\.ts$/,
        replacement: fileURLToPath(new URL('test/http-network.ts', import.meta.url)),
      },
    ],
  },
  test: {
    include: scenarios.map((name) => `core/test/${name}.test.ts`),
    testTimeout: 30_000,
  },
})
