import "server-only";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { seedFromAccountExport } from "./seed";
import { appDbPath } from "@/lib/core/paths";

// Read-write store for everything the user creates: chats, projects, bookmarks,
// follows, Studio workspaces, settings, and the synced My Channel data.
export const APP_DB_PATH = appDbPath();

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY, name TEXT, email TEXT, image TEXT, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS user_channels (
  id TEXT PRIMARY KEY, channel_id TEXT UNIQUE NOT NULL, name TEXT, handle TEXT, avatar TEXT,
  subscriber_count INTEGER, video_count INTEGER, is_active INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL, last_synced_at TEXT
);
CREATE TABLE IF NOT EXISTS channel_profiles (
  user_channel_id TEXT PRIMARY KEY, profile_json TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS style_guides (
  user_channel_id TEXT PRIMARY KEY, content TEXT, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS chat_preferences (
  user_channel_id TEXT PRIMARY KEY, prefs_json TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);

CREATE TABLE IF NOT EXISTS channel_videos (
  video_id TEXT PRIMARY KEY, user_channel_id TEXT, channel_id TEXT NOT NULL, title TEXT NOT NULL,
  thumbnail TEXT, views INTEGER, likes INTEGER, comments INTEGER, duration_seconds INTEGER,
  published_at TEXT, type TEXT NOT NULL DEFAULT 'longform', outlier_score REAL,
  comparison_json TEXT, raw TEXT, updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS channel_videos_channel ON channel_videos(channel_id, published_at DESC);
CREATE TABLE IF NOT EXISTS video_view_snapshots (
  video_id TEXT NOT NULL, captured_at TEXT NOT NULL, views INTEGER NOT NULL, PRIMARY KEY (video_id, captured_at)
);
CREATE TABLE IF NOT EXISTS trophies (
  id TEXT PRIMARY KEY, video_id TEXT NOT NULL, milestone INTEGER NOT NULL, achieved_at TEXT NOT NULL,
  seen INTEGER NOT NULL DEFAULT 0, UNIQUE (video_id, milestone)
);

CREATE TABLE IF NOT EXISTS chats (
  id TEXT PRIMARY KEY, title TEXT NOT NULL, user_channel_id TEXT, project_id TEXT,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS chat_messages (
  id TEXT PRIMARY KEY, chat_id TEXT NOT NULL, role TEXT NOT NULL, content TEXT NOT NULL DEFAULT '',
  cards_json TEXT, metadata_json TEXT, attachments_json TEXT, prompt_pill_json TEXT,
  feedback TEXT, created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS chat_messages_chat ON chat_messages(chat_id, created_at);
CREATE TABLE IF NOT EXISTS chat_attachments (
  id TEXT PRIMARY KEY, chat_id TEXT, kind TEXT NOT NULL, name TEXT, content TEXT,
  meta_json TEXT, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS title_feedback (
  id TEXT PRIMARY KEY, message_id TEXT, title TEXT NOT NULL, rating TEXT NOT NULL, reason TEXT,
  note TEXT, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS pinned_titles (
  id TEXT PRIMARY KEY, title TEXT NOT NULL, chat_id TEXT, message_id TEXT, project_id TEXT,
  meta_json TEXT, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS credit_usage (
  id TEXT PRIMARY KEY, chat_id TEXT, message_id TEXT, credits INTEGER NOT NULL,
  input_tokens INTEGER, output_tokens INTEGER, model TEXT, created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT, status TEXT NOT NULL DEFAULT 'idea',
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS project_items (
  id TEXT PRIMARY KEY, project_id TEXT NOT NULL, kind TEXT NOT NULL, ref_id TEXT,
  payload_json TEXT, created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS project_items_project ON project_items(project_id, created_at);

CREATE TABLE IF NOT EXISTS bookmarks (
  id TEXT PRIMARY KEY, video_id TEXT UNIQUE NOT NULL, video_json TEXT NOT NULL,
  is_short INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS tags (id TEXT PRIMARY KEY, name TEXT UNIQUE NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS bookmark_tags (
  bookmark_id TEXT NOT NULL, tag_id TEXT NOT NULL, PRIMARY KEY (bookmark_id, tag_id)
);

CREATE TABLE IF NOT EXISTS following_lists (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, type TEXT, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS followed_channels (
  channel_id TEXT PRIMARY KEY, name TEXT, handle TEXT, avatar TEXT, subscriber_count INTEGER,
  added_at TEXT NOT NULL, last_synced_at TEXT
);
CREATE TABLE IF NOT EXISTS following_list_channels (
  list_id TEXT NOT NULL, channel_id TEXT NOT NULL, PRIMARY KEY (list_id, channel_id)
);
CREATE TABLE IF NOT EXISTS hidden_channels (channel_id TEXT PRIMARY KEY, name TEXT, hidden_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS followed_videos (
  video_id TEXT PRIMARY KEY, channel_id TEXT NOT NULL, channel_name TEXT, title TEXT NOT NULL,
  thumbnail TEXT, views INTEGER, published_at TEXT, duration_seconds INTEGER, is_short INTEGER NOT NULL DEFAULT 0,
  outlier_score REAL, raw TEXT, updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS studio_workspaces (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, project_id TEXT, state_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS studio_assets (
  id TEXT PRIMARY KEY, workspace_id TEXT, kind TEXT NOT NULL, file_path TEXT NOT NULL, mime TEXT,
  created_at TEXT NOT NULL
);
`;

let handle: DatabaseSync | null = null;

export function appDb(): DatabaseSync {
  if (handle) return handle;
  fs.mkdirSync(path.dirname(APP_DB_PATH), { recursive: true });
  const db = new DatabaseSync(APP_DB_PATH);
  db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");
  db.exec(SCHEMA);
  const users = db.prepare("SELECT count(*) AS n FROM users").get() as { n: number };
  if (users.n === 0) seedFromAccountExport(db);
  handle = db;
  return db;
}

export const newId = () => randomUUID();
export const nowIso = () => new Date().toISOString();

export function getSetting<T>(key: string, fallback: T): T {
  const row = appDb().prepare("SELECT value FROM settings WHERE key = ?").get(key) as { value: string } | undefined;
  if (!row) return fallback;
  try {
    return JSON.parse(row.value) as T;
  } catch {
    return fallback;
  }
}

export function setSetting(key: string, value: unknown) {
  appDb()
    .prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
    .run(key, JSON.stringify(value));
}

/** Run fn inside a transaction. */
export function tx<T>(fn: (db: DatabaseSync) => T): T {
  const db = appDb();
  db.exec("BEGIN");
  try {
    const out = fn(db);
    db.exec("COMMIT");
    return out;
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}

export type UserChannel = {
  id: string;
  channelId: string;
  name: string | null;
  handle: string | null;
  avatar: string | null;
  subscriberCount: number | null;
  videoCount: number | null;
  isActive: boolean;
  lastSyncedAt: string | null;
};

export function listUserChannels(): UserChannel[] {
  const rows = appDb()
    .prepare("SELECT * FROM user_channels ORDER BY is_active DESC, created_at ASC")
    .all() as Record<string, unknown>[];
  return rows.map((r) => ({
    id: r.id as string,
    channelId: r.channel_id as string,
    name: (r.name as string) ?? null,
    handle: (r.handle as string) ?? null,
    avatar: (r.avatar as string) ?? null,
    subscriberCount: (r.subscriber_count as number) ?? null,
    videoCount: (r.video_count as number) ?? null,
    isActive: !!r.is_active,
    lastSyncedAt: (r.last_synced_at as string) ?? null,
  }));
}

export function activeChannel(): UserChannel | null {
  const channels = listUserChannels();
  return channels.find((c) => c.isActive) ?? channels[0] ?? null;
}

export function currentUser() {
  return appDb().prepare("SELECT * FROM users LIMIT 1").get() as
    | { id: string; name: string | null; email: string | null; image: string | null }
    | undefined;
}
