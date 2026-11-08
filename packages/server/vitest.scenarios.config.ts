import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

const scenarios = [
  'agility',
  'attacks',
  'client-recovery',
  'evidence',
  'guardian',
  'integrity',
  'ledger-check',
  'lineage',
  'operations',
  'party',
  'policy',
  'recovery',
  'witness',
]

/**
 * Runs the scenarios of `core`, unchanged, against real HTTP servers: only the network they
 * run on is swapped.
 */
export default defineConfig({
  root: fileURLToPath(new URL('..', import.meta.url)),
  resolve: {
    alias: [
      {
        find: /^\.\/support\/network\.ts$/,
        replacement: fileURLToPath(new URL('test/http-network.ts', import.meta.url)),
      },
    ],
  },
  test: {
    include: scenarios.map((name) => `core/test/${name}.test.ts`),
    testTimeout: 30_000,
  },
})
