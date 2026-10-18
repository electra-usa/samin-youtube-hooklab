// Applies one channel's polled uploads to the library: inserts new videos as `rss:<videoId>`,
// refreshes views on existing rows (which become source='rss' so rebuilds keep them),
// rescores the channel's videos per kind, keeps videos_fts and the channels aggregate in step,
// and records polling state. Pure DB work, idempotent, so it can be replayed after a swap.
import type { DatabaseSync, SQLInputValue } from "node:sqlite";
import { COMPARISON_WINDOW } from "../../channel/outliers.ts";
import { isOutlier, scoreAgainstHistory, tierFor, trustExportHistory, type HistoryVideo } from "./scoring.ts";
import { MIN_COMPARED, NEW_OUTLIER_MAX_AGE_DAYS } from "./settings.ts";
import { isoDuration } from "./util.ts";

export type PolledVideo = {
  videoId: string;
  title: string;
  publishedAt: string;
  views: number | null;
  isShort: boolean;
  channelName: string | null;
  /** Known from a ScrapeCreators listing (library add backfill). */
  durationSeconds?: number | null;
  /** The publish time is an estimate (a listing's "3 months ago"), not an exact timestamp. */
  approxDate?: boolean;
};

export type ChannelPoll = {
  channelId: string;
  channelName: string | null;
  videos: PolledVideo[];
  /** Result of the Shorts feed: 1 = has Shorts, 0 = none, null = not checked this time. */
  hasShorts: 0 | 1 | null;
  error: string | null;
  /** YouTube has no feed for this channel at all (deleted or terminated). */
  missing: boolean;
  requests: number;
};

export type ApplyStats = {
  newVideos: number;
  updatedVideos: number;
  newOutliers: number;
  /** Rows that crossed 2x in this apply (row ids), for enrichment/tagging and run output. */
  outlierRowIds: string[];
  newRowIds: string[];
};

const EMPTY: ApplyStats = { newVideos: 0, updatedVideos: 0, newOutliers: 0, outlierRowIds: [], newRowIds: [] };

type ExistingRow = {
  rowid: number;
  id: string;
  video_id: string;
  channel_id: string | null;
  title: string;
  channel_name: string | null;
  views: number | null;
  outlier_score: number | null;
  publish_at: string | null;
  is_short: number | null;
  source: string;
  niches: string | null;
  duration_seconds: number | null;
  ch_views: number | null;
  ch_score: number | null;
  lv_origin: string | null;
  lv_outlier_at: string | null;
};

type HistoryRow = {
  video_id: string;
  views: number | null;
  publish_at: string | null;
  source: string;
  observed: number;
};

const thumbnailUrl = (videoId: string) => `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
const videoUrl = (videoId: string, isShort: boolean) =>
  isShort ? `https://www.youtube.com/shorts/${videoId}` : `https://www.youtube.com/watch?v=${videoId}`;

function channelSubscribers(db: DatabaseSync, channelId: string): number | null {
  const lib = db.prepare("SELECT subscriber_count AS n FROM library_channels WHERE channel_id = ?").get(channelId) as { n: number | null } | undefined;
  if (lib?.n != null) return lib.n;
  const agg = db.prepare("SELECT subscriber_count AS n FROM channels WHERE channel_id = ?").get(channelId) as { n: number | null } | undefined;
  return agg?.n ?? null;
}

function existingRows(db: DatabaseSync, videoIds: string[]): Map<string, ExistingRow[]> {
  const rows = db
    .prepare(
      `SELECT v.rowid AS rowid, v.id, v.video_id, v.channel_id, v.title, v.channel_name, v.views, v.outlier_score, v.publish_at, v.is_short,
              v.source, v.niches, v.duration_seconds,
              CASE WHEN v.id NOT LIKE 'rss:%' THEN json_extract(v.raw, '$.views') END AS ch_views,
              CASE WHEN v.id NOT LIKE 'rss:%' THEN json_extract(v.raw, '$.outlierScore') END AS ch_score,
              lv.origin AS lv_origin, lv.outlier_at AS lv_outlier_at
       FROM videos v LEFT JOIN live_videos lv ON lv.video_id = v.video_id
       WHERE v.video_id IN (SELECT value FROM json_each(?))`,
    )
    .all(JSON.stringify(videoIds)) as ExistingRow[];
  const out = new Map<string, ExistingRow[]>();
  for (const r of rows) {
    const list = out.get(r.video_id) ?? [];
    list.push(r);
    out.set(r.video_id, list);
  }
  // Prefer the export row (its id is what bookmarks and projects reference) over our rss: twin.
  for (const list of out.values()) list.sort((a, b) => Number(a.id.startsWith("rss:")) - Number(b.id.startsWith("rss:")));
  return out;
}

function deleteRow(db: DatabaseSync, row: { rowid: number; id: string; title: string; channel_name: string | null }) {
  db.prepare("INSERT INTO videos_fts (videos_fts, rowid, title, channel_name) VALUES ('delete', ?, ?, ?)").run(row.rowid, row.title, row.channel_name);
  db.prepare("DELETE FROM video_niches WHERE video_row_id = ?").run(row.id);
  db.prepare("DELETE FROM video_click_triggers WHERE video_row_id = ?").run(row.id);
  db.prepare("DELETE FROM videos WHERE id = ?").run(row.id);
}

/**
 * Fold our rss:<videoId> row into an export row for the same video (the exporter caught up
 * with a video the pipeline found first). Keeps the export row id, the higher view count and
 * the export's tags when it has them; the merged row becomes source='rss'.
 */
export function mergeDuplicate(db: DatabaseSync, keep: ExistingRow, dupe: ExistingRow): void {
  const dupeTags = db.prepare("SELECT niches, click_triggers, frame, pov, duration, duration_seconds FROM videos WHERE id = ?").get(dupe.id) as
    | { niches: string; click_triggers: string; frame: string | null; pov: string | null; duration: string | null; duration_seconds: number | null }
    | undefined;
  const views = Math.max(keep.views ?? 0, dupe.views ?? 0);
  const keepUntagged = !keep.niches || keep.niches === "[]";
  db.prepare(
    `UPDATE videos SET views = ?, source = 'rss',
       niches = CASE WHEN ? THEN ? ELSE niches END, click_triggers = CASE WHEN ? THEN ? ELSE click_triggers END,
       frame = COALESCE(frame, ?), pov = COALESCE(pov, ?),
       duration = COALESCE(duration, ?), duration_seconds = COALESCE(duration_seconds, ?)
     WHERE id = ?`,
  ).run(
    views,
    keepUntagged ? 1 : 0,
    dupeTags?.niches ?? "[]",
    keepUntagged ? 1 : 0,
    dupeTags?.click_triggers ?? "[]",
    dupeTags?.frame ?? null,
    dupeTags?.pov ?? null,
    dupeTags?.duration ?? null,
    dupeTags?.duration_seconds ?? null,
    keep.id,
  );
  if (keepUntagged && dupeTags) {
    db.prepare("INSERT OR IGNORE INTO video_niches (video_row_id, niche) SELECT ?, niche FROM video_niches WHERE video_row_id = ?").run(keep.id, dupe.id);
    db.prepare(
      "INSERT OR IGNORE INTO video_click_triggers (video_row_id, click_trigger) SELECT ?, click_trigger FROM video_click_triggers WHERE video_row_id = ?",
    ).run(keep.id, dupe.id);
  }
  deleteRow(db, dupe);
  db.prepare("UPDATE live_videos SET row_id = ? WHERE video_id = ?").run(keep.id, keep.video_id);
}

/** Merge every rss: row whose video now also has another row (run at the start of each refresh). */
export function mergeAllDuplicates(db: DatabaseSync): number {
  const pairs = db
    .prepare(
      `SELECT DISTINCT lv.video_id FROM live_videos lv JOIN videos v ON v.video_id = lv.video_id AND v.id != lv.row_id
       WHERE lv.row_id LIKE 'rss:%'`,
    )
    .all() as { video_id: string }[];
  let merged = 0;
  const channels = new Set<string>();
  const byVideo = existingRows(db, pairs.map((p) => p.video_id));
  for (const rows of byVideo.values()) {
    const keep = rows.find((r) => !r.id.startsWith("rss:"));
    if (!keep) continue;
    for (const dupe of rows.filter((r) => r.id.startsWith("rss:"))) {
      mergeDuplicate(db, keep, dupe);
      merged++;
      if (keep.channel_id) channels.add(keep.channel_id);
    }
  }
  for (const channelId of channels) refreshChannelAggregate(db, channelId);
  return merged;
}

/** Recompute one channel's row in `channels` the same way the bulk rebuild does. */
export function refreshChannelAggregate(db: DatabaseSync, channelId: string): void {
  db.prepare(
    `INSERT OR REPLACE INTO channels
     SELECT channel_id, max(channel_name), max(subscriber_count), count(*), avg(outlier_score), max(outlier_score), sum(views),
            max(publish_at), 'https://www.youtube.com/channel/' || channel_id
     FROM videos WHERE channel_id = ? GROUP BY channel_id`,
  ).run(channelId);
}

function recordPollState(db: DatabaseSync, poll: ChannelPoll, now: string, newestUpload: string | null) {
  const failed = !!poll.error && !poll.videos.length;
  db.prepare(
    `INSERT INTO channel_poll_state (channel_id, channel_name, last_polled_at, last_success_at, last_upload_at, has_shorts, shorts_checked_at,
       consecutive_errors, last_error, polls)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
     ON CONFLICT(channel_id) DO UPDATE SET
       channel_name = COALESCE(excluded.channel_name, channel_name),
       last_polled_at = excluded.last_polled_at,
       last_success_at = COALESCE(excluded.last_success_at, last_success_at),
       last_upload_at = CASE WHEN excluded.last_upload_at > COALESCE(last_upload_at, '') THEN excluded.last_upload_at ELSE last_upload_at END,
       has_shorts = COALESCE(excluded.has_shorts, has_shorts),
       shorts_checked_at = COALESCE(excluded.shorts_checked_at, shorts_checked_at),
       consecutive_errors = CASE WHEN excluded.consecutive_errors = 0 THEN 0 ELSE consecutive_errors + 1 END,
       last_error = excluded.last_error,
       polls = polls + 1`,
  ).run(
    poll.channelId,
    poll.channelName,
    now,
    failed ? null : now,
    newestUpload,
    poll.hasShorts,
    poll.hasShorts == null ? null : now,
    failed ? 1 : 0,
    poll.error,
  );
  db.prepare("UPDATE library_channels SET last_synced_at = CASE WHEN ? THEN last_synced_at ELSE ? END, last_error = ? WHERE channel_id = ?").run(
    failed ? 1 : 0,
    now,
    poll.error,
    poll.channelId,
  );
}

/**
 * Apply a poll. With `dryRun` nothing is written; the returned stats say what would change.
 * `db` must be inside a transaction when writing.
 */
export function applyChannelPoll(db: DatabaseSync, poll: ChannelPoll, opts: { now: string; dryRun?: boolean }): ApplyStats {
  const { now, dryRun = false } = opts;
  const write = (sql: string, ...params: SQLInputValue[]) => {
    if (!dryRun) return db.prepare(sql).run(...params);
    return null;
  };
  // A feed can list a video twice across the long-form and Shorts playlists; keep the first.
  const seen = new Set<string>();
  const videos = poll.videos.filter((v) => !seen.has(v.videoId) && seen.add(v.videoId));
  const newestUpload = videos.reduce<string | null>((max, v) => (!max || v.publishedAt > max ? v.publishedAt : max), null);
  if (!videos.length) {
    if (!dryRun) recordPollState(db, poll, now, newestUpload);
    return EMPTY;
  }

  const stats: ApplyStats = { newVideos: 0, updatedVideos: 0, newOutliers: 0, outlierRowIds: [], newRowIds: [] };
  const recentFrom = new Date(Date.parse(now) - NEW_OUTLIER_MAX_AGE_DAYS * 86_400_000).toISOString();
  const existing = existingRows(db, videos.map((v) => v.videoId));
  // Fold our own duplicates into the export row before scoring.
  for (const rows of existing.values()) {
    if (rows.length < 2) continue;
    const keep = rows[0];
    for (const dupe of rows.slice(1).filter((r) => r.id.startsWith("rss:"))) {
      if (!dryRun && !keep.id.startsWith("rss:")) mergeDuplicate(db, keep, dupe);
    }
    existing.set(keep.video_id, keep.id.startsWith("rss:") ? [keep] : [keep, ...rows.slice(1).filter((r) => !r.id.startsWith("rss:"))]);
  }
  // Typed feeds are authoritative about the kind; correct rows filed under the other one.
  for (const v of videos) {
    for (const row of existing.get(v.videoId) ?? []) {
      if ((row.is_short ?? 0) !== (v.isShort ? 1 : 0)) {
        write("UPDATE videos SET is_short = ?, video_url = ? WHERE id = ?", v.isShort ? 1 : 0, videoUrl(v.videoId, v.isShort), row.id);
        row.is_short = v.isShort ? 1 : 0;
      }
    }
  }

  const subscribers = channelSubscribers(db, poll.channelId);
  for (const isShort of [false, true]) {
    const polled = videos.filter((v) => v.isShort === isShort);
    if (!polled.length) continue;
    const kind = isShort ? 1 : 0;
    const counts = db
      .prepare(
        "SELECT count(*) AS n, COALESCE(SUM(outlier_score < 2), 0) AS below FROM videos WHERE channel_id = ? AND is_short = ? AND source = 'export'",
      )
      .get(poll.channelId, kind) as { n: number; below: number };
    const trusted = trustExportHistory(Number(counts.n), Number(counts.below));
    const historyRows = db
      .prepare(
        `SELECT v.video_id, v.views, v.publish_at, v.source, (lv.video_id IS NOT NULL) AS observed
         FROM videos v LEFT JOIN live_videos lv ON lv.video_id = v.video_id
         WHERE v.channel_id = ? AND v.is_short = ? AND v.views IS NOT NULL
         ORDER BY v.publish_at DESC LIMIT 400`,
      )
      .all(poll.channelId, kind) as HistoryRow[];
    const history = new Map<string, HistoryVideo>();
    for (const h of historyRows) {
      const observed = !!h.observed;
      // Unobserved export rows only count when the export of this channel isn't outliers-only.
      if (!observed && h.source === "export" && !trusted) continue;
      history.set(h.video_id, { videoId: h.video_id, views: h.views ?? 0, publishedAt: h.publish_at, observed });
    }
    for (const v of polled) {
      const prev = history.get(v.videoId);
      const views = v.views ?? prev?.views;
      if (views == null) continue;
      history.set(v.videoId, { videoId: v.videoId, views, publishedAt: v.publishedAt, observed: true });
    }
    const scores = scoreAgainstHistory([...history.values()], polled.map((v) => v.videoId));

    for (const v of polled) {
      const ws = scores.get(v.videoId);
      const rows = existing.get(v.videoId) ?? [];
      if (!rows.length) {
        const views = v.views;
        const score = views == null || !ws || ws.compared < MIN_COMPARED ? null : ws.score;
        const id = `rss:${v.videoId}`;
        const channelName = v.channelName ?? poll.channelName;
        const durationSeconds = v.durationSeconds ?? null;
        const raw = JSON.stringify({
          id,
          videoId: v.videoId,
          title: v.title,
          videoUrl: videoUrl(v.videoId, v.isShort),
          thumbnail: thumbnailUrl(v.videoId),
          channelId: poll.channelId,
          channelName,
          publishAt: v.publishedAt,
          isShort: v.isShort,
          ...(v.approxDate ? { publishAtApprox: true } : {}),
          source: "rss",
          firstSeenAt: now,
          firstSeenViews: views,
        });
        stats.newVideos++;
        stats.newRowIds.push(id);
        if (isOutlier(score)) {
          if (v.publishedAt >= recentFrom) stats.newOutliers++;
          stats.outlierRowIds.push(id);
        }
        if (dryRun) continue;
        const inserted = db
          .prepare(
            `INSERT INTO videos (id, video_id, title, title_length, video_url, thumbnail_url, channel_id, channel_name, subscriber_count,
               views, outlier_score, tier, publish_at, duration, duration_seconds, is_short, frame, secondary_frame, pov,
               featured_in_newsletter, niches, click_triggers, video_types, raw, source)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, 0, '[]', '[]', '[]', ?, 'rss')`,
          )
          .run(
            id,
            v.videoId,
            v.title,
            v.title.length,
            videoUrl(v.videoId, v.isShort),
            thumbnailUrl(v.videoId),
            poll.channelId,
            channelName,
            subscribers,
            views,
            score,
            tierFor(score),
            v.publishedAt,
            isoDuration(durationSeconds),
            durationSeconds,
            v.isShort ? 1 : 0,
            raw,
          );
        db.prepare("INSERT INTO videos_fts (rowid, title, channel_name) VALUES (?, ?, ?)").run(inserted.lastInsertRowid, v.title, channelName);
        db.prepare(
          `INSERT INTO live_videos (video_id, row_id, channel_id, is_short, origin, first_seen_at, checked_at, baseline_views, compared, outlier_at, enriched_at)
           VALUES (?, ?, ?, ?, 'new', ?, ?, ?, ?, ?, ?)
           ON CONFLICT(video_id) DO UPDATE SET row_id = excluded.row_id, checked_at = excluded.checked_at,
             baseline_views = excluded.baseline_views, compared = excluded.compared, outlier_at = COALESCE(outlier_at, excluded.outlier_at)`,
        ).run(
          v.videoId,
          id,
          poll.channelId,
          v.isShort ? 1 : 0,
          now,
          now,
          ws?.baselineViews ?? null,
          ws?.compared ?? 0,
          isOutlier(score) ? now : null,
          durationSeconds != null ? now : null,
        );
        continue;
      }

      for (const row of rows) {
        const views = v.views ?? row.views;
        if (views == null) continue;
        // Export rows keep Creator Hooks' own baseline when our window is shorter than theirs was.
        const chBaseline = row.ch_views && row.ch_score && row.ch_score > 0 ? row.ch_views / row.ch_score : null;
        const useExportBaseline = chBaseline != null && (ws?.score == null || ws.compared < COMPARISON_WINDOW || (!trusted && !ws.observedWindow));
        const ours = ws && ws.compared >= MIN_COMPARED ? ws.score : null;
        const score = useExportBaseline ? views / (chBaseline as number) : (ours ?? row.outlier_score);
        const baseline = useExportBaseline ? Math.round(chBaseline as number) : (ws?.baselineViews ?? null);
        const crossed = isOutlier(score) && !isOutlier(row.outlier_score) && !row.lv_outlier_at;
        const titleChanged = !!v.title && v.title !== row.title;
        stats.updatedVideos++;
        if (crossed) {
          if ((row.publish_at ?? v.publishedAt) >= recentFrom) stats.newOutliers++;
          stats.outlierRowIds.push(row.id);
        }
        if (dryRun) continue;
        db.prepare(
          `UPDATE videos SET views = ?, outlier_score = ?, tier = ?, title = ?, title_length = ?, source = CASE WHEN source = 'export' THEN 'rss' ELSE source END,
             publish_at = CASE WHEN ? THEN ? ELSE COALESCE(publish_at, ?) END, subscriber_count = COALESCE(subscriber_count, ?),
             duration_seconds = COALESCE(duration_seconds, ?), duration = COALESCE(duration, ?)
           WHERE id = ?`,
        ).run(
          views,
          score,
          tierFor(score),
          titleChanged ? v.title : row.title,
          titleChanged ? v.title.length : row.title.length,
          // Our own rows take an exact time over an earlier estimate; export rows keep theirs.
          row.id.startsWith("rss:") && !v.approxDate ? 1 : 0,
          v.publishedAt,
          v.publishedAt,
          subscribers,
          v.durationSeconds ?? null,
          isoDuration(v.durationSeconds ?? null),
          row.id,
        );
        if (titleChanged) {
          db.prepare("INSERT INTO videos_fts (videos_fts, rowid, title, channel_name) VALUES ('delete', ?, ?, ?)").run(row.rowid, row.title, row.channel_name);
          db.prepare("INSERT INTO videos_fts (rowid, title, channel_name) VALUES (?, ?, ?)").run(row.rowid, v.title, row.channel_name);
        }
        db.prepare(
          `INSERT INTO live_videos (video_id, row_id, channel_id, is_short, origin, first_seen_at, checked_at, baseline_views, compared, outlier_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(video_id) DO UPDATE SET row_id = excluded.row_id, is_short = excluded.is_short, checked_at = excluded.checked_at,
             baseline_views = excluded.baseline_views, compared = excluded.compared, outlier_at = COALESCE(outlier_at, excluded.outlier_at)`,
        ).run(
          v.videoId,
          row.id,
          poll.channelId,
          v.isShort ? 1 : 0,
          row.id.startsWith("rss:") ? "new" : "export",
          now,
          now,
          baseline,
          useExportBaseline ? COMPARISON_WINDOW : (ws?.compared ?? 0),
          crossed ? now : null,
        );
      }
    }
  }

  if (!dryRun) {
    recordPollState(db, poll, now, newestUpload);
    refreshChannelAggregate(db, poll.channelId);
  }
  return stats;
}

/** Record a failed poll (no entries) without touching videos. */
export function applyPollFailure(db: DatabaseSync, poll: ChannelPoll, now: string): void {
  recordPollState(db, poll, now, null);
}
