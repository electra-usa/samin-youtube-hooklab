// Open handles on the video library for the app, the CLI and the refresh worker.
// Framework-free: no "server-only", relative imports with explicit .ts extensions.
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { libraryDbPath } from "./paths.ts";
import { ensureLibrary, migrateLibrary } from "./library-schema.ts";

let reader: { db: DatabaseSync; path: string; ino: number; checkedAt: number } | null = null;

/**
 * Shared read-only handle. Reopens when a bulk rebuild atomically replaces the file
 * (new inode); in-place writes by the refresh worker are visible without reopening.
 */
export function openLibraryReader(): DatabaseSync {
  const now = Date.now();
  if (reader && now - reader.checkedAt < 5_000) return reader.db;
  const file = libraryDbPath();
  ensureLibrary(file);
  const ino = fs.statSync(file).ino;
  if (!reader || reader.path !== file || reader.ino !== ino) {
    reader?.db.close();
    migrateOnce(file, ino);
    const db = new DatabaseSync(file, { readOnly: true });
    // The refresh worker writes in place (rollback journal); wait for its commits instead of
    // failing with "database is locked". (Not WAL: bulk rebuilds swap the file atomically.)
    db.exec("PRAGMA busy_timeout = 5000;");
    reader = { db, path: file, ino, checkedAt: now };
  }
  reader.checkedAt = now;
  return reader.db;
}

/** A fresh read-write handle (CLI imports, YouTube sync, refresh). Caller closes it. */
export function openLibraryWriter(): DatabaseSync {
  const file = libraryDbPath();
  ensureLibrary(file);
  const db = new DatabaseSync(file);
  db.exec("PRAGMA busy_timeout = 10000;");
  migrateLibrary(db);
  return db;
}

const migrated = new Set<string>();
function migrateOnce(file: string, ino: number) {
  const key = `${file}:${ino}`;
  if (migrated.has(key)) return;
  const db = new DatabaseSync(file);
  try {
    db.exec("PRAGMA busy_timeout = 10000;");
    migrateLibrary(db);
    migrated.add(key);
  } catch {
    // A concurrent writer holds the lock; the next open retries.
  } finally {
    db.close();
  }
}
