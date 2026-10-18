import "server-only";
import { listUserChannels, newId, nowIso, type UserChannel } from "@/lib/db/app";
import { collectKeyless, type ChannelUploads, type UploadRecord } from "@/lib/youtube/uploads";
import { collectWithDataApi, youtubeApiKey } from "@/lib/youtube/data-api";
import { fetchVideoDetails, ytdlpAvailable } from "@/lib/youtube/ytdlp";
import { channelDb } from "./schema";
import { computeComparisons } from "./outliers";
import { awardTrophies } from "./trophies";
import type { ChannelVideoRow, VideoKind } from "./videos";

// Channel sync: pulls the channel's uploads (Data API with YOUTUBE_API_KEY, else
// RSS + yt-dlp), upserts channel_videos, appends one view snapshot per video,
// recomputes the "vs. recent average" comparisons and awards milestone trophies.
// Runs in the background; progress lives in channel_sync_runs.

export type SyncState = "idle" | "queued" | "running" | "completed" | "failed";

export type SyncStatus = {
  success: true;
  state: SyncState;
  updatedAt: string | null;
  detail: string | null;
  pendingEnrichment: boolean;
  lastSyncedAt: string | null;
  runId: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  stats: SyncStats | null;
  error: string | null;
};

export type SyncStats = {
  source: string;
  videos: number;
  newVideos: number;
  exactRefreshed: number;
  titleChanges: number;
  trophiesAwarded: number;
  partial: boolean;
  notes: string[];
};

type RunRow = {
  id: string;
  user_channel_id: string;
  state: SyncState;
  detail: string | null;
  source: string | null;
  stats_json: string | null;
  error: string | null;
  started_at: string;
  updated_at: string;
  finished_at: string | null;
};

const STALE_RUN_MS = 10 * 60_000;
const COMPLETED_VISIBLE_MS = 2 * 60_000;
const DAY_MS = 86_400_000;
/** Exact per-video refreshes per normal sync (yt-dlp, ~1.5 s each, 4 in parallel). */
const DETAIL_BUDGET = 40;
const DEEP_DETAIL_BUDGET = 400;

// Shared across route bundles in one server process.
const g = globalThis as unknown as { __hooklabChannelSyncs?: Map<string, Promise<void>> };
const active = (g.__hooklabChannelSyncs ??= new Map());

function latestRun(userChannelId: string): RunRow | undefined {
  return channelDb()
    .prepare("SELECT * FROM channel_sync_runs WHERE user_channel_id = ? ORDER BY started_at DESC LIMIT 1")
    .get(userChannelId) as RunRow | undefined;
}

function updateRun(id: string, patch: Partial<Pick<RunRow, "state" | "detail" | "source" | "stats_json" | "error" | "finished_at">>) {
  const sets = Object.keys(patch).map((k) => `${k} = ?`);
  channelDb()
    .prepare(`UPDATE channel_sync_runs SET ${[...sets, "updated_at = ?"].join(", ")} WHERE id = ?`)
    .run(...(Object.values(patch) as (string | null)[]), nowIso(), id);
}

function isRunActive(run: RunRow | undefined) {
  return !!run && (run.state === "queued" || run.state === "running") && Date.now() - Date.parse(run.updated_at) < STALE_RUN_MS;
}

export function getSyncStatus(userChannelId: string): SyncStatus {
  const channel = listUserChannels().find((c) => c.id === userChannelId);
  const run = latestRun(userChannelId);
  let state: SyncState = "idle";
  if (run) {
    if (isRunActive(run)) state = run.state;
    else if (run.state === "failed") state = "failed";
    else if (run.state === "completed" && run.finished_at && Date.now() - Date.parse(run.finished_at) < COMPLETED_VISIBLE_MS) state = "completed";
    else if (run.state === "queued" || run.state === "running") state = "failed"; // the server stopped mid-run
  }
  return {
    success: true,
    state,
    updatedAt: run?.updated_at ?? null,
    detail: state === "failed" && run && !run.error && !run.finished_at ? "The last sync was interrupted." : (run?.detail ?? null),
    pendingEnrichment: false,
    lastSyncedAt: channel?.lastSyncedAt ?? null,
    runId: run?.id ?? null,
    startedAt: run?.started_at ?? null,
    finishedAt: run?.finished_at ?? null,
    stats: run?.stats_json ? (JSON.parse(run.stats_json) as SyncStats) : null,
    error: run?.error ?? null,
  };
}

export type StartResult =
  | { success: true; queued: true; runId: string; state: SyncState }
  | { success: true; skipped: true; reason: string; lastSyncedAt: string | null }
  | { success: false; error: string };

export function startChannelSync(userChannelId: string, opts: { deep?: boolean; ifStale?: boolean } = {}): StartResult {
  const channel = listUserChannels().find((c) => c.id === userChannelId);
  if (!channel) return { success: false, error: "Channel not found" };
  if (opts.ifStale && channel.lastSyncedAt && Date.now() - Date.parse(channel.lastSyncedAt) < DAY_MS) {
    return { success: true, skipped: true, reason: "Synced within the last 24 hours", lastSyncedAt: channel.lastSyncedAt };
  }
  const current = latestRun(userChannelId);
  if (active.has(userChannelId) || isRunActive(current)) {
    return { success: true, queued: true, runId: current!.id, state: current!.state };
  }
  const id = newId();
  const now = nowIso();
  channelDb()
    .prepare("INSERT INTO channel_sync_runs (id, user_channel_id, state, detail, started_at, updated_at) VALUES (?, ?, 'queued', ?, ?, ?)")
    .run(id, userChannelId, "Waiting to start…", now, now);
  const job = runSync(id, channel, !!opts.deep)
    .catch((err: unknown) => {
      updateRun(id, { state: "failed", error: err instanceof Error ? err.message : String(err), detail: "Sync failed", finished_at: nowIso() });
    })
    .finally(() => active.delete(userChannelId));
  active.set(userChannelId, job);
  return { success: true, queued: true, runId: id, state: "queued" };
}

/** YouTube shows truncated counts ("1.3K"); returns the width of that bucket. */
function floorBucket(floor: number): number {
  if (floor < 1_000) return 1;
  if (floor < 10_000) return 100;
  if (floor < 1_000_000) return 1_000;
  if (floor < 10_000_000) return 100_000;
  return 1_000_000;
}

/** Best view count when only a truncated listing value is known. */
function viewsFromFloor(stored: number | null | undefined, floor: number): number {
  if (stored == null) return floor;
  if (floor < 1_000) return floor; // exact below 1K
  if (stored >= floor && stored < floor + floorBucket(floor)) return stored; // still consistent
  return floor; // grew past (or dropped below) what we knew
}

/** True when the stored publish time was interpolated by an earlier sync. */
function dateWasEstimated(row: ChannelVideoRow | undefined): boolean {
  if (!row?.raw) return false;
  try {
    return (JSON.parse(row.raw) as { dateEstimated?: boolean }).dateEstimated === true;
  } catch {
    return false;
  }
}

function needsExactRefresh(rec: UploadRecord, existing: ChannelVideoRow | undefined) {
  if (rec.views != null) return !!rec.viewsStale;
  if (!existing) return !rec.publishedAt;
  if (rec.viewsFloor == null) return false;
  return viewsFromFloor(existing.views, rec.viewsFloor) !== existing.views;
}

async function collect(channel: UserChannel, onDetail: (d: string) => void): Promise<ChannelUploads> {
  const key = youtubeApiKey();
  if (key) {
    try {
      onDetail("Fetching uploads from the YouTube Data API…");
      return await collectWithDataApi(channel.channelId, key);
    } catch (err) {
      onDetail("YouTube Data API unavailable, using RSS and yt-dlp…");
      const fallback = await collectKeyless(channel.channelId);
      fallback.notes.unshift(`YouTube Data API failed: ${err instanceof Error ? err.message : String(err)}`);
      return fallback;
    }
  }
  onDetail("Fetching your uploads from YouTube…");
  return collectKeyless(channel.channelId);
}

async function runSync(runId: string, channel: UserChannel, deep: boolean) {
  const db = channelDb();
  updateRun(runId, { state: "running", detail: "Starting sync…" });
  const result = await collect(channel, (detail) => updateRun(runId, { detail }));
  if (!result.uploads.length) {
    throw new Error(result.notes.join(" ") || "Couldn't reach YouTube. Check your connection and try again.");
  }

  const existingRows = db.prepare("SELECT * FROM channel_videos WHERE channel_id = ?").all(channel.channelId) as ChannelVideoRow[];
  const existing = new Map(existingRows.map((r) => [r.video_id, r]));

  // Exact per-video refreshes: every new upload without a publish time (a first sync
  // of a channel does them all), then earlier date guesses and counts that moved.
  let exactRefreshed = 0;
  if (ytdlpAvailable() && !result.sources.includes("youtube-api")) {
    const pick = (list: UploadRecord[], n: number) => [...list].sort((a, b) => a.order - b.order).slice(0, n);
    const groups = deep
      ? [pick(result.uploads.filter((u) => u.views == null || !u.publishedAt), DEEP_DETAIL_BUDGET)]
      : [
          pick(result.uploads.filter((u) => !existing.has(u.videoId) && !u.publishedAt), DEEP_DETAIL_BUDGET),
          pick(result.uploads.filter((u) => !u.publishedAt && dateWasEstimated(existing.get(u.videoId))), DETAIL_BUDGET),
          pick(result.uploads.filter((u) => existing.has(u.videoId) && needsExactRefresh(u, existing.get(u.videoId))), DETAIL_BUDGET),
        ];
    const candidates = [...new Map(groups.flat().map((u) => [u.videoId, u])).values()];
    if (candidates.length) {
      const label = (done: number) => `Refreshing exact stats (${done}/${candidates.length} videos)…`;
      updateRun(runId, { detail: label(0) });
      const details = await fetchVideoDetails(
        candidates.map((c) => c.videoId),
        { onProgress: (done) => updateRun(runId, { detail: label(done) }) },
      );
      for (const rec of candidates) {
        const d = details.get(rec.videoId);
        if (!d) continue;
        exactRefreshed++;
        rec.title = d.title || rec.title;
        rec.views = d.views ?? rec.views;
        rec.viewsStale = false;
        rec.publishedAt = d.publishedAt ?? rec.publishedAt;
        rec.durationSeconds = d.durationSeconds ?? rec.durationSeconds;
        rec.likes = d.likes ?? rec.likes;
        rec.comments = d.comments ?? rec.comments;
        rec.sources.push("ytdlp-video");
      }
    }
  }

  updateRun(runId, { detail: "Saving videos and recalculating outlier scores…" });
  const now = nowIso();
  const finalViews = (rec: UploadRecord) => {
    const prev = existing.get(rec.videoId);
    if (rec.views != null) return rec.viewsStale && rec.viewsFloor != null ? Math.max(rec.views, rec.viewsFloor) : rec.views;
    if (rec.viewsFloor != null) return viewsFromFloor(prev?.views, rec.viewsFloor);
    return prev?.views ?? 0;
  };

  // Uploads with no known publish time get one between their listing neighbours.
  const dates = new Map<string, string | null>();
  for (const kind of ["longform", "shorts", "live"] as VideoKind[]) {
    const ofKind = result.uploads.filter((u) => u.kind === kind).sort((a, b) => a.order - b.order);
    const known = ofKind.map((u) => u.publishedAt ?? existing.get(u.videoId)?.published_at ?? null);
    ofKind.forEach((u, i) => {
      if (known[i]) return dates.set(u.videoId, known[i]);
      const newer = known.slice(0, i).reverse().find(Boolean) ?? null;
      const older = known.slice(i + 1).find(Boolean) ?? null;
      const guess =
        newer && older
          ? new Date((Date.parse(newer) + Date.parse(older)) / 2).toISOString()
          : (u.approxPublishedAt ?? older ?? newer ?? now);
      dates.set(u.videoId, guess);
    });
  }

  let newVideos = 0;
  let titleChanges = 0;
  let trophiesAwarded = 0;
  const upsert = db.prepare(
    `INSERT INTO channel_videos (video_id, user_channel_id, channel_id, title, thumbnail, views, likes, comments,
       duration_seconds, published_at, type, raw, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(video_id) DO UPDATE SET user_channel_id = excluded.user_channel_id, title = excluded.title,
       thumbnail = excluded.thumbnail, views = excluded.views, likes = excluded.likes, comments = excluded.comments,
       duration_seconds = excluded.duration_seconds, published_at = excluded.published_at, type = excluded.type,
       raw = excluded.raw, updated_at = excluded.updated_at`,
  );
  const snapshot = db.prepare("INSERT OR REPLACE INTO video_view_snapshots (video_id, captured_at, views) VALUES (?, ?, ?)");
  const change = db.prepare(
    `INSERT INTO video_change_history (id, video_id, change_type, old_title, new_title, old_thumbnail, new_thumbnail, changed_at)
     VALUES (?, ?, 'title', ?, ?, NULL, NULL, ?)`,
  );
  const setComparison = db.prepare("UPDATE channel_videos SET outlier_score = ?, comparison_json = ? WHERE video_id = ?");

  db.exec("BEGIN");
  try {
    for (const rec of result.uploads) {
      const prev = existing.get(rec.videoId);
      if (!prev) newVideos++;
      // Listing titles can be title-test variants, so only exact sources update an existing title.
      const title = rec.title ?? prev?.title ?? rec.listTitle ?? "Untitled video";
      if (prev && rec.title && rec.title !== prev.title) {
        change.run(newId(), rec.videoId, prev.title, rec.title, now);
        titleChanges++;
      }
      const views = finalViews(rec);
      const thumbnail =
        prev?.thumbnail ?? `https://i.ytimg.com/vi/${rec.videoId}/${rec.kind === "live" ? "hqdefault_live" : "hqdefault"}.jpg`;
      const raw = JSON.stringify({
        sources: rec.sources,
        listTitle: rec.listTitle,
        viewsFloor: rec.viewsFloor,
        approxPublishedAt: rec.approxPublishedAt,
        dateEstimated: !rec.publishedAt && (!prev?.published_at || dateWasEstimated(prev)),
        order: rec.order,
        syncedAt: now,
      });
      upsert.run(
        rec.videoId,
        channel.id,
        channel.channelId,
        title,
        thumbnail,
        views,
        rec.likes ?? prev?.likes ?? null,
        rec.comments ?? prev?.comments ?? null,
        rec.durationSeconds ?? prev?.duration_seconds ?? null,
        dates.get(rec.videoId) ?? prev?.published_at ?? now,
        rec.kind,
        raw,
        now,
      );
      snapshot.run(rec.videoId, now, views);
    }

    // Recompute comparisons over every stored video of each kind.
    const all = db.prepare("SELECT video_id, views, published_at, type FROM channel_videos WHERE user_channel_id = ?").all(channel.id) as {
      video_id: string;
      views: number | null;
      published_at: string | null;
      type: string;
    }[];
    for (const kind of ["longform", "shorts", "live"]) {
      const comps = computeComparisons(
        all.filter((v) => v.type === kind).map((v) => ({ videoId: v.video_id, views: v.views ?? 0, publishedAt: v.published_at })),
      );
      for (const [videoId, c] of comps) setComparison.run(c ? Number(c.multiplier) : null, c ? JSON.stringify(c) : null, videoId);
    }

    const count = (db.prepare("SELECT count(*) AS n FROM channel_videos WHERE user_channel_id = ?").get(channel.id) as { n: number }).n;
    const tracking = db.prepare("SELECT created_at FROM user_channels WHERE id = ?").get(channel.id) as { created_at: string } | undefined;
    db.prepare(
      `UPDATE user_channels SET last_synced_at = ?, video_count = ?,
         subscriber_count = COALESCE(?, subscriber_count), avatar = COALESCE(?, avatar), handle = COALESCE(?, handle),
         name = COALESCE(name, ?)
       WHERE id = ?`,
    ).run(
      now,
      count,
      result.channel.subscriberCount ?? null,
      result.channel.avatar ?? null,
      result.channel.handle ?? null,
      result.channel.name ?? null,
      channel.id,
    );
    trophiesAwarded = awardTrophies(channel.id, tracking?.created_at ?? now).length;
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }

  const stats: SyncStats = {
    source: result.sources.join(", "),
    videos: result.uploads.length,
    newVideos,
    exactRefreshed,
    titleChanges,
    trophiesAwarded,
    partial: result.partial,
    notes: result.notes,
  };
  updateRun(runId, {
    state: "completed",
    source: result.sources.join(", "),
    detail: `Synced ${result.uploads.length} videos${newVideos ? ` (${newVideos} new)` : ""}${result.partial ? " — partial" : ""}`,
    stats_json: JSON.stringify(stats),
    finished_at: nowIso(),
  });
}
