// Read access to the library for the query core, plus small caches keyed by the library's
// identity (file inode + highest rowid) so a rebuild or a refresh invalidates them.
import fs from "node:fs";
import type { DatabaseSync, SQLInputValue } from "node:sqlite";
import { openLibraryReader } from "../library-db.ts";
import { libraryDbPath } from "../paths.ts";

const tuned = new WeakSet<DatabaseSync>();

/**
 * The shared read-only handle. The library is in rollback-journal mode, so a reader that
 * arrives while the refresh pipeline commits gets SQLITE_BUSY at once; a busy timeout makes
 * it wait for the (short) commit instead. Applied once per handle (it changes on rebuilds).
 */
export function libraryDb(): DatabaseSync {
  const db = openLibraryReader();
  if (!tuned.has(db)) {
    db.exec("PRAGMA busy_timeout = 5000");
    tuned.add(db);
  }
  return db;
}

/** Changes when the file is swapped (rebuild) or rows are inserted (refresh). */
export function librarySignature(db: DatabaseSync): string {
  let ino = 0;
  try {
    ino = fs.statSync(libraryDbPath()).ino;
  } catch {
    // missing file: openLibraryReader creates it
  }
  const row = db.prepare("SELECT max(rowid) AS r FROM videos").get() as { r: number | null };
  return `${ino}:${row.r ?? 0}`;
}

type Entry = { sig: string; at: number; value: unknown };
const caches = new Map<string, Entry>();
const MAX_ENTRIES = 300;

/** Memoize `compute` per library signature for up to `ttlMs` (in-place updates age out by TTL). */
export function cached<T>(db: DatabaseSync, key: string, ttlMs: number, compute: () => T): T {
  const sig = librarySignature(db);
  const hit = caches.get(key);
  const now = Date.now();
  if (hit && hit.sig === sig && now - hit.at < ttlMs) return hit.value as T;
  const value = compute();
  if (caches.size >= MAX_ENTRIES) {
    const oldest = [...caches.entries()].sort((a, b) => a[1].at - b[1].at).slice(0, MAX_ENTRIES / 3);
    for (const [k] of oldest) caches.delete(k);
  }
  caches.set(key, { sig, at: now, value });
  return value;
}

export function countOf(db: DatabaseSync, sql: string, params: SQLInputValue[] = []): number {
  const row = db.prepare(sql).get(...params) as { n: number | null } | undefined;
  return Number(row?.n ?? 0);
}

export function totalVideos(db: DatabaseSync): number {
  return cached(db, "total", 60_000, () => countOf(db, "SELECT count(*) AS n FROM videos"));
}

export function metaValues(db: DatabaseSync): Record<string, string> {
  const rows = db.prepare("SELECT key, value FROM meta").all() as { key: string; value: string | null }[];
  return Object.fromEntries(rows.map((r) => [r.key, r.value ?? ""]));
}

const placeholders = (n: number) => Array.from({ length: n }, () => "?").join(", ");
export { placeholders };
