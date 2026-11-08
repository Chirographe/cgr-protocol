/**
 * Tables of a guardian. Each value spent by a line is a primary key of `spent`, so the
 * database itself refuses a value spent twice, whatever the code above it does.
 */
export const GUARDIAN_SCHEMA = `
CREATE TABLE IF NOT EXISTS lines (
  n INTEGER PRIMARY KEY,
  type TEXT NOT NULL,
  hash TEXT NOT NULL,
  date TEXT NOT NULL,
  line_hash TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS spent (
  value TEXT PRIMARY KEY,
  line INTEGER NOT NULL REFERENCES lines (n),
  position INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS spent_line ON spent (line, position);
CREATE TABLE IF NOT EXISTS rotations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  rotation TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS transitions (hash TEXT PRIMARY KEY, transition TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS token_index (token TEXT PRIMARY KEY, entry TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS claims (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  output TEXT NOT NULL,
  transition TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS claims_output ON claims (output, id);
CREATE TABLE IF NOT EXISTS commitments (transition TEXT PRIMARY KEY, commitment TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS notices (token TEXT PRIMARY KEY, notice TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS published_head (id INTEGER PRIMARY KEY CHECK (id = 1), head TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  scan TEXT NOT NULL,
  date TEXT NOT NULL,
  content TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS messages_scan ON messages (scan);
`
