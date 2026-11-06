import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import type { KeyVault } from '@chirographe/core'

const VAULT_SCHEMA = `
CREATE TABLE IF NOT EXISTS vault (id INTEGER PRIMARY KEY CHECK (id = 1), sealed TEXT NOT NULL);
`

/**
 * One connection, with one operation at a time. A transaction stays open across `await`s,
 * so anything run beside it would silently join it: every access goes through `exclusive`.
 */
export class Database {
  readonly sql: DatabaseSync
  private queue: Promise<unknown> = Promise.resolve()

  constructor(folder: string, file: string, schema: string) {
    mkdirSync(folder, { recursive: true })
    this.sql = new DatabaseSync(join(folder, file))
    // Exclusive: a second process on the same ledger fails at once instead of forking it.
    this.sql.exec(`
      PRAGMA locking_mode = EXCLUSIVE;
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = FULL;
    `)
    this.sql.exec(schema + VAULT_SCHEMA)
  }

  exclusive<T>(work: () => T | Promise<T>): Promise<T> {
    const next = this.queue.then(work, work)
    this.queue = next.catch(() => undefined)
    return next
  }

  transaction<T>(work: () => Promise<T>): Promise<T> {
    return this.exclusive(async () => {
      this.sql.exec('BEGIN IMMEDIATE')
      try {
        const result = await work()
        this.sql.exec('COMMIT')
        return result
      } catch (error) {
        this.sql.exec('ROLLBACK')
        throw error
      }
    })
  }

  vault(): KeyVault {
    return {
      load: () =>
        this.exclusive(() => {
          const row = this.sql.prepare('SELECT sealed FROM vault WHERE id = 1').get()
          return row ? (row.sealed as string) : null
        }),
      save: (sealed) =>
        this.exclusive(() => {
          this.sql
            .prepare(
              `INSERT INTO vault (id, sealed) VALUES (1, ?)
               ON CONFLICT (id) DO UPDATE SET sealed = excluded.sealed`,
            )
            .run(sealed)
        }),
    }
  }

  close(): Promise<void> {
    return this.exclusive(() => this.sql.close())
  }
}

export const json = (value: unknown): string => JSON.stringify(value)
export const parsed = <T>(value: unknown): T => JSON.parse(value as string) as T
