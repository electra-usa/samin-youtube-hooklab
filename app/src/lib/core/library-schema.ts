// Canonical schema of the video library (data/library.db). Every writer uses it:
// the CLI's YouTube library builder and importer here, and any bulk rebuild script,
// which must preserve rows whose `source` is not "export".
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

export const LIBRARY_SCHEMA = `
CREATE TABLE IF NOT EXISTS videos (
  id TEXT PRIMARY KEY,
  video_id TEXT NOT NULL,
  title TEXT NOT NULL,
  title_length INTEGER,
  video_url TEXT,
  thumbnail_url TEXT,
  channel_id TEXT,
  channel_name TEXT,
  subscriber_count INTEGER,
  views INTEGER,
  outlier_score REAL,
  tier TEXT,
  publish_at TEXT,
  duration TEXT,
  duration_seconds INTEGER,
  is_short INTEGER,
  frame TEXT,
  secondary_frame TEXT,
  pov TEXT,
  featured_in_newsletter INTEGER,
  niches TEXT,
  click_triggers TEXT,
  video_types TEXT,
  raw TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'export'
);
CREATE INDEX IF NOT EXISTS videos_video_id ON videos(video_id);
CREATE INDEX IF NOT EXISTS videos_channel ON videos(channel_id);
CREATE INDEX IF NOT EXISTS videos_publish ON videos(publish_at DESC);
CREATE INDEX IF NOT EXISTS videos_outlier ON videos(outlier_score DESC);
CREATE INDEX IF NOT EXISTS videos_views ON videos(views DESC);

CREATE TABLE IF NOT EXISTS video_niches (video_row_id TEXT NOT NULL, niche TEXT NOT NULL, PRIMARY KEY (video_row_id, niche));
CREATE INDEX IF NOT EXISTS video_niches_niche ON video_niches(niche);
CREATE TABLE IF NOT EXISTS video_click_triggers (video_row_id TEXT NOT NULL, click_trigger TEXT NOT NULL, PRIMARY KEY (video_row_id, click_trigger));
CREATE INDEX IF NOT EXISTS video_click_triggers_trigger ON video_click_triggers(click_trigger);

CREATE VIRTUAL TABLE IF NOT EXISTS videos_fts USING fts5(title, channel_name, content='videos', content_rowid='rowid', tokenize='porter unicode61');

CREATE TABLE IF NOT EXISTS channels (
  channel_id TEXT PRIMARY KEY,
  channel_name TEXT,
  subscriber_count INTEGER,
  video_count INTEGER,
  avg_outlier_score REAL,
  max_outlier_score REAL,
  total_views INTEGER,
  latest_publish_at TEXT,
  channel_url TEXT
);

-- Channels added to the library from YouTube (hooklab library add); survives rebuilds.
CREATE TABLE IF NOT EXISTS library_channels (
  channel_id TEXT PRIMARY KEY,
  handle TEXT,
  name TEXT,
  avatar TEXT,
  subscriber_count INTEGER,
  added_at TEXT NOT NULL,
  last_synced_at TEXT,
  last_error TEXT
);

CREATE TABLE IF NOT EXISTS taxonomy (kind TEXT NOT NULL, value TEXT NOT NULL, label TEXT, data TEXT, PRIMARY KEY (kind, value));
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);

-- Query core (hooklab CLI and /api/v1). Expression and partial indexes on purpose: queries
-- that filter on plain subscriber_count or is_short keep their existing plans.
CREATE INDEX IF NOT EXISTS videos_subscribers_sort ON videos(coalesce(subscriber_count, -1) DESC);
CREATE INDEX IF NOT EXISTS videos_source ON videos(source);
CREATE INDEX IF NOT EXISTS videos_shorts ON videos(publish_at DESC) WHERE is_short = 1;

-- Live outliers pipeline (src/lib/core/ingest). Extra tables, so bulk rebuilds carry them over.
-- Per-channel state of the RSS polling rotation.
CREATE TABLE IF NOT EXISTS channel_poll_state (
  channel_id TEXT PRIMARY KEY,
  channel_name TEXT,
  last_polled_at TEXT,
  last_success_at TEXT,
  last_upload_at TEXT,
  has_shorts INTEGER,
  shorts_checked_at TEXT,
  subs_checked_at TEXT,
  consecutive_errors INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  paused INTEGER NOT NULL DEFAULT 0,
  polls INTEGER NOT NULL DEFAULT 0
);
-- Every video the pipeline has seen in a feed: origin 'new' (inserted as rss:<videoId>) or 'export'.
CREATE TABLE IF NOT EXISTS live_videos (
  video_id TEXT PRIMARY KEY,
  row_id TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  is_short INTEGER NOT NULL DEFAULT 0,
  origin TEXT NOT NULL,
  first_seen_at TEXT NOT NULL,
  checked_at TEXT NOT NULL,
  baseline_views INTEGER,
  compared INTEGER,
  outlier_at TEXT,
  enriched_at TEXT,
  tagged_at TEXT,
  tag_attempts INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS live_videos_channel ON live_videos(channel_id, is_short);
CREATE INDEX IF NOT EXISTS live_videos_first_seen ON live_videos(first_seen_at);
CREATE INDEX IF NOT EXISTS live_videos_outlier_at ON live_videos(outlier_at);
CREATE INDEX IF NOT EXISTS live_videos_row ON live_videos(row_id);
CREATE TABLE IF NOT EXISTS refresh_runs (
  id INTEGER PRIMARY KEY,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  status TEXT NOT NULL,
  trigger TEXT NOT NULL,
  dry_run INTEGER NOT NULL DEFAULT 0,
  channels_planned INTEGER NOT NULL DEFAULT 0,
  channels_polled INTEGER NOT NULL DEFAULT 0,
  requests INTEGER NOT NULL DEFAULT 0,
  new_videos INTEGER NOT NULL DEFAULT 0,
  updated_videos INTEGER NOT NULL DEFAULT 0,
  new_outliers INTEGER NOT NULL DEFAULT 0,
  enriched INTEGER NOT NULL DEFAULT 0,
  tagged INTEGER NOT NULL DEFAULT 0,
  discovered_channels INTEGER NOT NULL DEFAULT 0,
  credits_used INTEGER NOT NULL DEFAULT 0,
  ai_cost_usd REAL NOT NULL DEFAULT 0,
  errors INTEGER NOT NULL DEFAULT 0,
  error_sample TEXT,
  options TEXT
);
CREATE INDEX IF NOT EXISTS refresh_runs_started ON refresh_runs(started_at);
-- ScrapeCreators ledger: one row per paid API call (daily budget, credits remaining).
CREATE TABLE IF NOT EXISTS scrapecreators_calls (
  id INTEGER PRIMARY KEY,
  at TEXT NOT NULL,
  endpoint TEXT NOT NULL,
  status INTEGER,
  credits_charged INTEGER NOT NULL DEFAULT 0,
  credits_remaining INTEGER,
  run_id INTEGER
);
CREATE INDEX IF NOT EXISTS scrapecreators_calls_at ON scrapecreators_calls(at);
-- Discovery: rotating search queries and the channels they surfaced.
CREATE TABLE IF NOT EXISTS discovery_queries (
  query TEXT PRIMARY KEY,
  source TEXT NOT NULL,
  last_run_at TEXT,
  runs INTEGER NOT NULL DEFAULT 0,
  candidates INTEGER NOT NULL DEFAULT 0,
  added INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS discovered_channels (
  channel_id TEXT PRIMARY KEY,
  status TEXT NOT NULL,
  query TEXT,
  video_id TEXT,
  video_views INTEGER,
  subscriber_count INTEGER,
  ratio REAL,
  checked_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS ingest_state (key TEXT PRIMARY KEY, value TEXT);
`;

/** Create an empty library with the full schema when none exists yet (fresh clone). */
export function ensureLibrary(dbPath: string): void {
  if (fs.existsSync(dbPath)) return;
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  try {
    db.exec(LIBRARY_SCHEMA);
    db.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES ('created_at', ?)").run(new Date().toISOString());
  } finally {
    db.close();
  }
}

/** Add columns/tables introduced after a library file was built (older exports lack `source`). */
export function migrateLibrary(db: DatabaseSync): void {
  const cols = db.prepare("PRAGMA table_info(videos)").all() as { name: string }[];
  if (cols.length && !cols.some((c) => c.name === "source")) {
    db.exec("ALTER TABLE videos ADD COLUMN source TEXT NOT NULL DEFAULT 'export'");
  }
  db.exec(LIBRARY_SCHEMA);
}
