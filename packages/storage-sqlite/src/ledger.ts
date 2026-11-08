import type { DatabaseSync } from 'node:sqlite'
import {
  hashLine,
  type Commitment,
  type Hash,
  type IndexEntry,
  type LedgerTransaction,
  type Line,
  type NoticeRecord,
  type Rotation,
  type Transition,
} from '@chirographe/core'
import { json, parsed } from './database.ts'

type Row = Record<string, unknown>

/** Runs synchronous SQLite work behind the asynchronous interface of `core`. */
const resolved = <T>(work: () => T): Promise<T> => {
  try {
    return Promise.resolve(work())
  } catch (error) {
    return Promise.reject(error as Error)
  }
}

/** A table of JSON documents, one per key. */
function documents<T>(sql: DatabaseSync, table: string, id: string, column: string) {
  return {
    get: (key: string): T | null => {
      const row = sql.prepare(`SELECT ${column} FROM ${table} WHERE ${id} = ?`).get(key)
      return row ? parsed<T>(row[column]) : null
    },
    all: (): T[] =>
      sql
        .prepare(`SELECT ${column} FROM ${table} ORDER BY rowid`)
        .all()
        .map((row) => parsed<T>(row[column])),
    save: (key: string, value: T): void => {
      sql
        .prepare(
          `INSERT INTO ${table} (${id}, ${column}) VALUES (?, ?)
           ON CONFLICT (${id}) DO UPDATE SET ${column} = excluded.${column}`,
        )
        .run(key, json(value))
    },
    delete: (key: string): void => {
      sql.prepare(`DELETE FROM ${table} WHERE ${id} = ?`).run(key)
    },
  }
}

function linesFrom(sql: DatabaseSync, from: number, limit: number): Line[] {
  const rows = sql
    .prepare('SELECT n, type, hash, date FROM lines WHERE n >= ? ORDER BY n LIMIT ?')
    .all(from, limit)
  const last = rows.at(-1)?.n as number | undefined
  const spent = new Map<number, Hash[]>()
  if (last !== undefined) {
    const values = sql
      .prepare('SELECT line, value FROM spent WHERE line BETWEEN ? AND ? ORDER BY line, position')
      .all(from, last)
    for (const { line, value } of values) {
      spent.set(line as number, [...(spent.get(line as number) ?? []), value as Hash])
    }
  }
  return rows.map((row: Row) => ({
    n: row.n as number,
    type: row.type as Line['type'],
    hash: row.hash as Hash,
    spent: spent.get(row.n as number) ?? [],
    date: row.date as string,
  }))
}

function appendLine(sql: DatabaseSync, line: Line): void {
  sql
    .prepare('INSERT INTO lines (n, type, hash, date, line_hash) VALUES (?, ?, ?, ?, ?)')
    .run(line.n, line.type, line.hash, line.date, hashLine(line))
  const insert = sql.prepare('INSERT INTO spent (value, line, position) VALUES (?, ?, ?)')
  for (const [position, value] of line.spent.entries()) insert.run(value, line.n, position)
}

/** The reads and writes of one transaction, on a connection already inside it. */
export function ledgerTransaction(sql: DatabaseSync): LedgerTransaction {
  const transitions = documents<Transition>(sql, 'transitions', 'hash', 'transition')
  const index = documents<IndexEntry>(sql, 'token_index', 'token', 'entry')
  const commitments = documents<Commitment>(sql, 'commitments', 'transition', 'commitment')
  const notices = documents<NoticeRecord>(sql, 'notices', 'token', 'notice')

  return {
    appendLine: (line) => resolved(() => appendLine(sql, line)),
    lineCount: () =>
      resolved(() => sql.prepare('SELECT COUNT(*) AS c FROM lines').get()?.c as number),
    lines: (from, limit) => resolved(() => linesFrom(sql, from, limit)),
    lineHashes: () =>
      resolved(() =>
        sql
          .prepare('SELECT line_hash FROM lines ORDER BY n')
          .all()
          .map((row) => row.line_hash as Hash),
      ),
    isSpent: (value) =>
      resolved(() => sql.prepare('SELECT 1 FROM spent WHERE value = ?').get(value) !== undefined),
    rotations: () =>
      resolved(() =>
        sql
          .prepare('SELECT rotation FROM rotations ORDER BY id')
          .all()
          .map((row) => parsed<Rotation>(row.rotation)),
      ),
    saveRotation: (rotation) =>
      resolved(() => {
        sql.prepare('INSERT INTO rotations (rotation) VALUES (?)').run(json(rotation))
      }),
    transition: (hash) => resolved(() => transitions.get(hash)),
    saveTransition: (hash, transition) => resolved(() => transitions.save(hash, transition)),
    index: (token) => resolved(() => index.get(token)),
    indexEntries: () => resolved(() => index.all()),
    saveIndex: (entry) => resolved(() => index.save(entry.token, entry)),
    saveClaim: (claim) =>
      resolved(() => {
        sql
          .prepare('INSERT INTO claims (output, transition) VALUES (?, ?)')
          .run(claim.output, claim.transition)
      }),
    claims: (output) =>
      resolved(() =>
        sql
          .prepare('SELECT transition FROM claims WHERE output = ? ORDER BY id')
          .all(output)
          .map((row) => row.transition as Hash),
      ),
    commitment: (hash) => resolved(() => commitments.get(hash)),
    saveCommitment: (commitment) =>
      resolved(() => commitments.save(commitment.transition, commitment)),
    deleteCommitment: (hash) => resolved(() => commitments.delete(hash)),
    notice: (token) => resolved(() => notices.get(token)),
    notices: () => resolved(() => notices.all()),
    saveNotice: (notice) => resolved(() => notices.save(notice.token, notice)),
  }
}
