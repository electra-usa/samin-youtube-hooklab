// One refresh at a time across processes (Next.js server, CLI, worker container): an
// exclusive lockfile in the data directory, kept fresh by a heartbeat. A lock whose
// heartbeat is older than 10 minutes, or whose process is gone (same host), is stale.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { dataDir } from "../paths.ts";

const STALE_MS = 10 * 60_000;
const HEARTBEAT_MS = 30_000;

export type LockInfo = { token: string; owner: string; pid: number; host: string; runId: number | null; startedAt: string };
export type LockState = LockInfo & { heartbeatAt: string; stale: boolean };

export const lockPath = () => path.join(dataDir(), "refresh.lock");

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === "EPERM";
  }
}

/**
 * Tokens of locks this process holds right now. Process-wide (not per module): inside Next.js
 * the scheduler and the API routes can load this file as separate module instances.
 */
const HELD_KEY = Symbol.for("hooklab.refreshLockTokens");
const heldTokens: Set<string> = ((globalThis as Record<symbol, unknown>)[HELD_KEY] as Set<string> | undefined) ?? new Set<string>();
(globalThis as Record<symbol, unknown>)[HELD_KEY] = heldTokens;

export function readLock(): LockState | null {
  const file = lockPath();
  try {
    const info = JSON.parse(fs.readFileSync(file, "utf8")) as LockInfo;
    const mtime = fs.statSync(file).mtimeMs;
    const sameHost = info.host === os.hostname();
    // In a container a restarted worker is PID 1 again: a lock naming our own PID that we
    // don't hold was left by a previous incarnation.
    const leftover = sameHost && info.pid === process.pid && !heldTokens.has(info.token);
    const stale = Date.now() - mtime > STALE_MS || (sameHost && !alive(info.pid)) || leftover;
    return { ...info, heartbeatAt: new Date(mtime).toISOString(), stale };
  } catch {
    return null;
  }
}

export type RefreshLock = {
  token: string;
  setRunId: (runId: number) => void;
  /** False when another process took the lock over (ours went stale). */
  held: () => boolean;
  release: () => void;
};

export function acquireLock(owner: string): RefreshLock | null {
  const file = lockPath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const info: LockInfo = { token: randomUUID(), owner, pid: process.pid, host: os.hostname(), runId: null, startedAt: new Date().toISOString() };
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      fs.writeFileSync(file, JSON.stringify(info), { flag: "wx" });
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
      const current = readLock();
      if (current && !current.stale) return null;
      try {
        fs.unlinkSync(file);
      } catch {
        // Someone else cleared it first.
      }
      continue;
    }
    return lockHandle(file, info);
  }
  return null;
}

function lockHandle(file: string, info: LockInfo): RefreshLock {
  let released = false;
  heldTokens.add(info.token);
  const held = () => !released && readLock()?.token === info.token;
  const write = () => {
    try {
      if (held()) fs.writeFileSync(file, JSON.stringify(info));
    } catch {
      // A failed heartbeat only risks the lock going stale.
    }
  };
  const timer = setInterval(write, HEARTBEAT_MS);
  timer.unref?.();
  const release = () => {
    if (released) return;
    clearInterval(timer);
    try {
      if (readLock()?.token === info.token) fs.unlinkSync(file);
    } catch {
      // already gone
    }
    released = true;
    heldTokens.delete(info.token);
    process.off("exit", release);
  };
  process.on("exit", release);
  return {
    token: info.token,
    setRunId: (runId) => {
      info.runId = runId;
      write();
    },
    held,
    release,
  };
}
