// Where HookLab keeps its data. Shared by the Next.js app and the `hooklab` CLI,
// so this module must stay framework-free (no "server-only", no "@/" imports).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** Repository-level data directory (override with HOOKLAB_DATA_DIR). */
export function dataDir(): string {
  if (process.env.HOOKLAB_DATA_DIR) return path.resolve(process.env.HOOKLAB_DATA_DIR);
  // Inside Next.js the bundle location is meaningless; the app runs from app/.
  if (process.env.NEXT_RUNTIME) return path.resolve(process.cwd(), "..", "data");
  return fileURLToPath(new URL("../../../../data/", import.meta.url));
}

/** The video library. Prefers data/library.db; falls back to the older data/creatorhooks.db name. */
export function libraryDbPath(): string {
  if (process.env.LIBRARY_DB_PATH) return path.resolve(process.env.LIBRARY_DB_PATH);
  const preferred = path.join(dataDir(), "library.db");
  const legacy = path.join(dataDir(), "creatorhooks.db");
  if (!fs.existsSync(preferred) && fs.existsSync(legacy)) return legacy;
  return preferred;
}

/** Your own HookLab data (chats, projects, bookmarks, settings). */
export function appDbPath(): string {
  if (process.env.APP_DB_PATH) return path.resolve(process.env.APP_DB_PATH);
  return path.join(dataDir(), "app.db");
}
