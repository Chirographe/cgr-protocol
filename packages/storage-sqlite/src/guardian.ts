import {
  hashLine,
  type GuardianStorage,
  type GuardianStore,
  type Hash,
  type Head,
  type IndexEntry,
  type Key,
  type LedgerTransaction,
  type Line,
  type MailboxStore,
  type RecoveryRequest,
  type RelayMessage,
  type Rotation,
  type StoredMessage,
  type Token,
} from '@chirographe/core'
import { Database, json, parsed } from './database.ts'

const SCHEMA = `
CREATE TABLE IF NOT EXISTS lines (
  n INTEGER PRIMARY KEY,
  type TEXT NOT NULL,
  token_id TEXT NOT NULL,
  state_hash TEXT NOT NULL,
  spent TEXT UNIQUE,
  origin TEXT,
  date TEXT NOT NULL,
  hash TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS tokens (state_hash TEXT PRIMARY KEY, token TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS token_index (token_id TEXT PRIMARY KEY, entry TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS commitments (state_hash TEXT PRIMARY KEY, commitment TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS recoveries (token_id TEXT PRIMARY KEY, request TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS published_head (id INTEGER PRIMARY KEY CHECK (id = 1), head TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  scan TEXT NOT NULL,
  date TEXT NOT NULL,
  content TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS messages_scan ON messages (scan);
`

type Row = Record<string, unknown>

const toLine = (row: Row): Line => ({
  n: row.n as number,
  type: row.type as Line['type'],
  token_id: row.token_id as Hash,
  state_hash: row.state_hash as Hash,
  spent: row.spent as Hash | null,
  origin: row.origin === null ? null : parsed<Line['origin']>(row.origin),
  date: row.date as string,
})

function ledgerTransaction({ sql }: Database): LedgerTransaction {
  const resolved = <T>(work: () => T): Promise<T> => {
    try {
      return Promise.resolve(work())
    } catch (error) {
      return Promise.reject(error as Error)
    }
  }
  const save = (table: string, id: string, column: string, key: string, value: unknown) =>
    resolved(() => {
      sql
        .prepare(
          `INSERT INTO ${table} (${id}, ${column}) VALUES (?, ?)
           ON CONFLICT (${id}) DO UPDATE SET ${column} = excluded.${column}`,
        )
        .run(key, json(value))
    })

  return {
    appendLine: (line) =>
      resolved(() => {
        sql
          .prepare(
            `INSERT INTO lines (n, type, token_id, state_hash, spent, origin, date, hash)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            line.n,
            line.type,
            line.token_id,
            line.state_hash,
            line.spent,
            line.origin === null ? null : json(line.origin),
            line.date,
            hashLine(line),
          )
      }),
    lineCount: () =>
      resolved(() => sql.prepare('SELECT COUNT(*) AS c FROM lines').get()?.c as number),
    lines: (from, limit) =>
      resolved(() =>
        sql
          .prepare('SELECT * FROM lines WHERE n >= ? ORDER BY n LIMIT ?')
          .all(from, limit)
          .map((row) => toLine(row as Row)),
      ),
    lineHashes: () =>
      resolved(() =>
        sql
          .prepare('SELECT hash FROM lines ORDER BY n')
          .all()
          .map((row) => row.hash as Hash),
      ),
    isConsumed: (hash) =>
      resolved(() => sql.prepare('SELECT 1 FROM lines WHERE spent = ?').get(hash) !== undefined),
    rotations: () =>
      resolved(() =>
        sql
          .prepare(`SELECT origin FROM lines WHERE type = 'rotation' ORDER BY n`)
          .all()
          .map((row) => parsed<Rotation>(row.origin)),
      ),
    token: (hash) =>
      resolved(() => {
        const row = sql.prepare('SELECT token FROM tokens WHERE state_hash = ?').get(hash)
        return row ? parsed<Token>(row.token) : null
      }),
    saveToken: (hash, token) => save('tokens', 'state_hash', 'token', hash, token),
    index: (id) =>
      resolved(() => {
        const row = sql.prepare('SELECT entry FROM token_index WHERE token_id = ?').get(id)
        return row ? parsed<IndexEntry>(row.entry) : null
      }),
    indexEntries: () =>
      resolved(() =>
        sql
          .prepare('SELECT entry FROM token_index')
          .all()
          .map((row) => parsed<IndexEntry>(row.entry)),
      ),
    saveIndex: (entry) => save('token_index', 'token_id', 'entry', entry.token_id, entry),
    saveCommitment: (commitment) =>
      save('commitments', 'state_hash', 'commitment', commitment.state_hash, commitment),
    deleteCommitment: (hash) =>
      resolved(() => {
        sql.prepare('DELETE FROM commitments WHERE state_hash = ?').run(hash)
      }),
    recovery: (id) =>
      resolved(() => {
        const row = sql.prepare('SELECT request FROM recoveries WHERE token_id = ?').get(id)
        return row ? parsed<RecoveryRequest>(row.request) : null
      }),
    recoveries: () =>
      resolved(() =>
        sql
          .prepare('SELECT request FROM recoveries')
          .all()
          .map((row) => parsed<RecoveryRequest>(row.request)),
      ),
    saveRecovery: (request) => save('recoveries', 'token_id', 'request', request.token_id, request),
  }
}

class SqliteGuardianStore implements GuardianStore {
  private readonly tx: LedgerTransaction

  constructor(private readonly database: Database) {
    this.tx = ledgerTransaction(database)
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
  const database = new Database(folder, 'guardian.sqlite', SCHEMA)
  return {
    guardian: new SqliteGuardianStore(database),
    mailboxes: new SqliteMailboxStore(database),
    vault: database.vault(),
    close: () => database.close(),
  }
}
