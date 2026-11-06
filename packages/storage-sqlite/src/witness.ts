import type {
  Followed,
  FraudProof,
  Head,
  Key,
  WitnessStorage,
  WitnessStore,
} from '@chirographe/core'
import { Database, json, parsed } from './database.ts'

const SCHEMA = `
CREATE TABLE IF NOT EXISTS followed (key TEXT PRIMARY KEY, entry TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS heads (
  guardian TEXT NOT NULL,
  n INTEGER NOT NULL,
  head TEXT NOT NULL,
  PRIMARY KEY (guardian, n)
);
CREATE TABLE IF NOT EXISTS frauds (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  guardian TEXT NOT NULL,
  reason TEXT NOT NULL,
  root TEXT NOT NULL,
  proof TEXT NOT NULL,
  UNIQUE (guardian, reason, root)
);
`

class SqliteWitnessStore implements WitnessStore {
  constructor(private readonly database: Database) {}

  followed(): Promise<Followed[]> {
    return this.database.exclusive(() =>
      this.database.sql
        .prepare('SELECT entry FROM followed ORDER BY rowid')
        .all()
        .map((row) => parsed<Followed>(row.entry)),
    )
  }

  saveFollowed(entry: Followed): Promise<void> {
    return this.database.exclusive(() => {
      this.database.sql
        .prepare(
          `INSERT INTO followed (key, entry) VALUES (?, ?)
           ON CONFLICT (key) DO UPDATE SET entry = excluded.entry`,
        )
        .run(entry.key, json(entry))
    })
  }

  recordHead(guardian: Key, head: Head): Promise<Head> {
    return this.database.exclusive(() => {
      const { sql } = this.database
      sql
        .prepare('INSERT OR IGNORE INTO heads (guardian, n, head) VALUES (?, ?, ?)')
        .run(guardian, head.n, json(head))
      const row = sql.prepare('SELECT head FROM heads WHERE guardian = ? AND n = ?')
      return parsed<Head>(row.get(guardian, head.n)?.head)
    })
  }

  frauds(guardian: Key): Promise<FraudProof[]> {
    return this.database.exclusive(() =>
      this.database.sql
        .prepare('SELECT proof FROM frauds WHERE guardian = ? ORDER BY id')
        .all(guardian)
        .map((row) => parsed<FraudProof>(row.proof)),
    )
  }

  recordFraud(proof: FraudProof): Promise<FraudProof> {
    return this.database.exclusive(() => {
      const { sql } = this.database
      const id = [proof.guardian, proof.reason, proof.head_a.root] as const
      sql
        .prepare('INSERT OR IGNORE INTO frauds (guardian, reason, root, proof) VALUES (?, ?, ?, ?)')
        .run(...id, json(proof))
      const row = sql.prepare(
        'SELECT proof FROM frauds WHERE guardian = ? AND reason = ? AND root = ?',
      )
      return parsed<FraudProof>(row.get(...id)?.proof)
    })
  }
}

/** Everything a witness keeps, in `<folder>/witness.sqlite`. */
export function openWitnessStorage(folder: string): WitnessStorage {
  const database = new Database(folder, 'witness.sqlite', SCHEMA)
  return {
    witness: new SqliteWitnessStore(database),
    vault: database.vault(),
    close: () => database.close(),
  }
}
