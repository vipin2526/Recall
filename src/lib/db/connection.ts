import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { SCHEMA_SQL } from './schema';

const globalForDb = globalThis as unknown as {
  __recallDb?: Database.Database;
  __recallDbFile?: string;
};

function dbFile(): string {
  // Vercel functions get a read-only project directory; only /tmp is writable.
  const configured = process.env.DB_FILE ?? (process.env.VERCEL ? '/tmp/recall.db' : 'data/recall.db');
  return path.isAbsolute(configured)
    ? configured
    : path.join(/* turbopackIgnore: true */ process.cwd(), configured);
}

export function getDb(): Database.Database {
  const file = dbFile();
  if (globalForDb.__recallDb && globalForDb.__recallDbFile === file) {
    return globalForDb.__recallDb;
  }

  fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  db.exec(SCHEMA_SQL);

  globalForDb.__recallDb = db;
  globalForDb.__recallDbFile = file;
  return db;
}

export function closeDb(): void {
  globalForDb.__recallDb?.close();
  globalForDb.__recallDb = undefined;
  globalForDb.__recallDbFile = undefined;
}

/** Runs `fn` inside a write transaction. Nested calls reuse the outer transaction. */
export function tx<T>(fn: () => T): T {
  const db = getDb();
  return db.inTransaction ? fn() : db.transaction(fn)();
}
