import type {
  GuardianStorage,
  GuardianStore,
  Head,
  Key,
  LedgerTransaction,
  MailboxStore,
  RelayMessage,
  StoredMessage,
} from '@chirographe/core'
import { Database, json, parsed } from './database.ts'
import { GUARDIAN_SCHEMA } from './guardian-schema.ts'
import { ledgerTransaction } from './ledger.ts'

const GUARDIAN_FILE = 'guardian.sqlite'

class SqliteGuardianStore implements GuardianStore {
  private readonly tx: LedgerTransaction

  constructor(private readonly database: Database) {
    this.tx = ledgerTransaction(database.sql)
  }

  transaction<T>(work: (tx: LedgerTransaction) => Promise<T>): Promise<T> {
    return this.database.transaction(() => work(this.tx))
  }

  publishedHead(): Promise<Head | null> {
    return this.database.exclusive(() => {
      const row = this.database.sql.prepare('SELECT head FROM published_head WHERE id = 1').get()
      return row ? parsed<Head>(row.head) : null
    })
  }

  publishHead(head: Head): Promise<void> {
    return this.database.exclusive(() => {
      this.database.sql
        .prepare(
          `INSERT INTO published_head (id, head) VALUES (1, ?)
           ON CONFLICT (id) DO UPDATE SET head = excluded.head`,
        )
        .run(json(head))
    })
  }
}

class SqliteMailboxStore implements MailboxStore {
  constructor(private readonly database: Database) {}

  add(scan: Key, date: string, content: RelayMessage): Promise<number> {
    return this.database.exclusive(() => {
      const { lastInsertRowid } = this.database.sql
        .prepare('INSERT INTO messages (scan, date, content) VALUES (?, ?, ?)')
        .run(scan, date, json(content))
      return Number(lastInsertRowid)
    })
  }

  list(scan: Key): Promise<StoredMessage[]> {
    return this.database.exclusive(() =>
      this.database.sql
        .prepare('SELECT id, date, content FROM messages WHERE scan = ? ORDER BY id')
        .all(scan)
        .map((row) => ({
          id: row.id as number,
          date: row.date as string,
          content: parsed<RelayMessage>(row.content),
        })),
    )
  }

  remove(scan: Key, id: number): Promise<void> {
    return this.database.exclusive(() => {
      this.database.sql.prepare('DELETE FROM messages WHERE scan = ? AND id = ?').run(scan, id)
    })
  }
}

/** Everything a guardian keeps, in `<folder>/guardian.sqlite`. */
export function openGuardianStorage(folder: string): GuardianStorage {
  const database = new Database(folder, GUARDIAN_FILE, GUARDIAN_SCHEMA)
  return {
    guardian: new SqliteGuardianStore(database),
    mailboxes: new SqliteMailboxStore(database),
    vault: database.vault(),
    close: () => database.close(),
  }
}
