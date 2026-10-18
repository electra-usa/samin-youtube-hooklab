// Short write transactions against the library, each on a freshly opened handle, so a bulk
// rebuild that atomically swaps data/library.db (scripts/private/build-db.py) can't strand a
// whole run on the old file. The rebuild copies live rows near its end, so a write that lands
// while a rebuild is in progress (its library.db.tmp-* file exists) may miss the copy: those
// writes are journaled and replayed once the swap is seen. Every write is an idempotent upsert.
import fs from "node:fs";
import type { DatabaseSync } from "node:sqlite";
import { openLibraryWriter } from "../library-db.ts";
import { dataDir, libraryDbPath } from "../paths.ts";
import { sleep } from "./util.ts";

type Apply = (db: DatabaseSync) => unknown;

export function rebuildInProgress(): boolean {
  try {
    return fs.readdirSync(dataDir()).some((f) => f.startsWith("library.db.tmp-"));
  } catch {
    return false;
  }
}

const inode = () => {
  try {
    return fs.statSync(libraryDbPath()).ino;
  } catch {
    return 0;
  }
};

export type LibraryWriter = {
  /** Run `apply` inside one IMMEDIATE transaction on a fresh handle. */
  write: <T>(apply: (db: DatabaseSync) => T) => T;
  /** At the end of a run: wait out a rebuild that is still going, then replay what it may have missed. */
  settle: (maxWaitMs?: number) => Promise<void>;
};

function inTransaction<T>(db: DatabaseSync, fn: () => T): T {
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = fn();
    db.exec("COMMIT");
    return result;
  } catch (err) {
    try {
      db.exec("ROLLBACK");
    } catch {
      // already rolled back
    }
    throw err;
  }
}

export function createLibraryWriter(): LibraryWriter {
  const journal: { ino: number; apply: Apply }[] = [];
  let lastIno = 0;

  const open = (): { db: DatabaseSync; ino: number } => {
    for (let attempt = 0; ; attempt++) {
      const before = inode();
      const db = openLibraryWriter();
      const after = inode();
      if (before === after || attempt >= 2) return { db, ino: after };
      db.close();
    }
  };

  const replayInto = (db: DatabaseSync, ino: number) => {
    const missed = journal.filter((e) => e.ino !== ino);
    if (!missed.length) return;
    inTransaction(db, () => {
      for (const entry of missed) entry.apply(db);
    });
    for (const entry of missed) entry.ino = ino;
  };

  return {
    write(apply) {
      const { db, ino } = open();
      try {
        if (lastIno && ino !== lastIno) replayInto(db, ino);
        // Writes made before a rebuild starts are always in its copy; only later ones need a replay.
        const risky = rebuildInProgress();
        const result = inTransaction(db, () => apply(db));
        if (risky) journal.push({ ino, apply });
        else if (!rebuildInProgress()) journal.length = 0;
        lastIno = ino;
        return result;
      } finally {
        db.close();
      }
    },
    async settle(maxWaitMs = 120_000) {
      if (!journal.length) return;
      const deadline = Date.now() + maxWaitMs;
      while (rebuildInProgress() && Date.now() < deadline) await sleep(1_000);
      const ino = inode();
      if (ino && ino !== lastIno) {
        const { db, ino: opened } = open();
        try {
          replayInto(db, opened);
          lastIno = opened;
        } finally {
          db.close();
        }
      }
      if (!rebuildInProgress()) journal.length = 0;
    },
  };
}
