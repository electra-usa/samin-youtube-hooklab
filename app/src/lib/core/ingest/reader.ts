// The shared read-only library handle, set to wait out the refresh's short commits (the
// library uses a rollback journal, so a reader arriving mid-commit would get SQLITE_BUSY).
import type { DatabaseSync } from "node:sqlite";
import { openLibraryReader } from "../library-db.ts";

const tuned = new WeakSet<DatabaseSync>();

export function libraryReader(): DatabaseSync {
  const db = openLibraryReader();
  if (!tuned.has(db)) {
    db.exec("PRAGMA busy_timeout = 5000");
    tuned.add(db);
  }
  return db;
}
