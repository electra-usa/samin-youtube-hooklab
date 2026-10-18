import "server-only";
import type { DatabaseSync } from "node:sqlite";
import { appDb } from "@/lib/db/app";

// Tables the My Channel area adds on top of the shared app schema (lib/db/app.ts).
const CHANNEL_SCHEMA = `
CREATE TABLE IF NOT EXISTS channel_sync_runs (
  id TEXT PRIMARY KEY, user_channel_id TEXT NOT NULL, state TEXT NOT NULL, detail TEXT,
  source TEXT, stats_json TEXT, error TEXT, started_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  finished_at TEXT
);
CREATE INDEX IF NOT EXISTS channel_sync_runs_channel ON channel_sync_runs(user_channel_id, started_at DESC);
CREATE TABLE IF NOT EXISTS trophy_awards (
  trophy_id TEXT PRIMARY KEY, user_channel_id TEXT, type TEXT NOT NULL DEFAULT 'VIEW_MILESTONE',
  title TEXT, views_at_award INTEGER, baseline_views INTEGER, outlier_score_at_award REAL
);
CREATE TABLE IF NOT EXISTS video_change_history (
  id TEXT PRIMARY KEY, video_id TEXT NOT NULL, change_type TEXT NOT NULL, old_title TEXT, new_title TEXT,
  old_thumbnail TEXT, new_thumbnail TEXT, changed_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS video_change_history_video ON video_change_history(video_id, changed_at);
CREATE INDEX IF NOT EXISTS video_view_snapshots_time ON video_view_snapshots(captured_at);
`;

let ready = false;

/** App DB with the My Channel tables in place. */
export function channelDb(): DatabaseSync {
  const db = appDb();
  if (!ready) {
    db.exec(CHANNEL_SCHEMA);
    ready = true;
  }
  return db;
}
