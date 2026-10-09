import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

// One local SQLite file, using the database built into Node. It holds
// accounts, each person's saved notices, and the shared library of
// non-personal summaries. Photos are never stored.
let db: DatabaseSync | null = null;

export function database(): DatabaseSync {
  if (db) return db;
  const dir = join(process.cwd(), "data");
  mkdirSync(dir, { recursive: true });
  db = new DatabaseSync(join(dir, "app.db"));
  db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY,
      username TEXT NOT NULL UNIQUE,
      salt TEXT NOT NULL,
      hash TEXT NOT NULL,
      created TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS documents (
      id INTEGER PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created TEXT NOT NULL,
      language TEXT NOT NULL,
      notice TEXT NOT NULL,
      search_text TEXT NOT NULL,
      embedding TEXT
    );
    CREATE INDEX IF NOT EXISTS documents_user ON documents(user_id, created);
    CREATE TABLE IF NOT EXISTS library (
      id INTEGER PRIMARY KEY,
      created TEXT NOT NULL,
      source TEXT NOT NULL,
      dedupe TEXT NOT NULL UNIQUE,
      summary TEXT NOT NULL,
      search_text TEXT NOT NULL,
      embedding TEXT
    );
  `);
  // Added after the first version: the Google account a user signs in with.
  const columns = db.prepare("PRAGMA table_info(users)").all() as { name: string }[];
  if (!columns.some((c) => c.name === "google_sub")) {
    db.exec("ALTER TABLE users ADD COLUMN google_sub TEXT");
  }
  // The name Google gives for the person, shown instead of their email.
  if (!columns.some((c) => c.name === "name")) db.exec("ALTER TABLE users ADD COLUMN name TEXT");
  db.exec("CREATE UNIQUE INDEX IF NOT EXISTS users_google ON users(google_sub) WHERE google_sub IS NOT NULL");
  return db;
}
