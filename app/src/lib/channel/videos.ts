import "server-only";
import type { UserChannel } from "@/lib/db/app";
import { channelDb } from "./schema";
import type { Comparison } from "./outliers";

export type VideoKind = "longform" | "shorts" | "live";
export type VideoTab = "longform" | "shorts" | "livestreams";
export type VideoSort = "latest" | "oldest" | "popular" | "unpopular" | "outlier";
export type TimeFilter = "all" | "7" | "30" | "365";

/** Same shape as the original /api/my-channel/videos item. */
export type MyChannelVideo = {
  id: string;
  videoId: string;
  title: string;
  thumbnail: string;
  views: number;
  videoUrl: string;
  publishAt: string | null;
  duration: string;
  durationSeconds: number | null;
  isShort: boolean;
  isLivestream: boolean;
  periodViews: number | null;
  comparison: Comparison | null;
  hasChanges: boolean;
};

export type ChannelVideoRow = {
  video_id: string;
  user_channel_id: string | null;
  channel_id: string;
  title: string;
  thumbnail: string | null;
  views: number | null;
  likes: number | null;
  comments: number | null;
  duration_seconds: number | null;
  published_at: string | null;
  type: string;
  outlier_score: number | null;
  comparison_json: string | null;
  raw: string | null;
  updated_at: string;
};

/** The original caps each tab at 200 videos ("maxTotal" in its API). */
export const MAX_TOTAL = 200;

export const TAB_TO_KIND: Record<VideoTab, VideoKind> = { longform: "longform", shorts: "shorts", livestreams: "live" };

export function isoDuration(seconds: number | null | undefined): string {
  if (!seconds || seconds <= 0) return "P0D";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  return `PT${h ? `${h}H` : ""}${m ? `${m}M` : ""}${s || (!h && !m) ? `${s}S` : ""}`;
}

function parseComparison(json: string | null): Comparison | null {
  if (!json) return null;
  try {
    return JSON.parse(json) as Comparison;
  } catch {
    return null;
  }
}

export function toMyChannelVideo(row: ChannelVideoRow, extras: { periodViews?: number | null; hasChanges?: boolean } = {}): MyChannelVideo {
  return {
    id: row.video_id,
    videoId: row.video_id,
    title: row.title,
    thumbnail: row.thumbnail ?? `https://i.ytimg.com/vi/${row.video_id}/hqdefault.jpg`,
    views: row.views ?? 0,
    videoUrl: `https://www.youtube.com/watch?v=${row.video_id}`,
    publishAt: row.published_at,
    duration: isoDuration(row.duration_seconds),
    durationSeconds: row.duration_seconds,
    isShort: row.type === "shorts",
    isLivestream: row.type === "live",
    periodViews: extras.periodViews ?? null,
    comparison: parseComparison(row.comparison_json),
    hasChanges: !!extras.hasChanges,
  };
}

function videosWithChanges(videoIds: string[]): Set<string> {
  if (!videoIds.length) return new Set();
  const rows = channelDb()
    .prepare(`SELECT DISTINCT video_id FROM video_change_history WHERE video_id IN (${videoIds.map(() => "?").join(",")})`)
    .all(...videoIds) as { video_id: string }[];
  return new Set(rows.map((r) => r.video_id));
}

/** Views each video had at `cutoffIso` (latest snapshot at or before it). */
function viewsAt(userChannelId: string, cutoffIso: string): Map<string, number> {
  const rows = channelDb()
    .prepare(
      `SELECT s.video_id, s.views FROM video_view_snapshots s
       JOIN (SELECT s2.video_id, MAX(s2.captured_at) AS t FROM video_view_snapshots s2
             JOIN channel_videos v ON v.video_id = s2.video_id
             WHERE v.user_channel_id = ? AND s2.captured_at <= ? GROUP BY s2.video_id) m
         ON m.video_id = s.video_id AND m.t = s.captured_at`,
    )
    .all(userChannelId, cutoffIso) as { video_id: string; views: number }[];
  return new Map(rows.map((r) => [r.video_id, r.views]));
}

function earliestViews(userChannelId: string): Map<string, number> {
  const rows = channelDb()
    .prepare(
      `SELECT s.video_id, s.views FROM video_view_snapshots s
       JOIN (SELECT s2.video_id, MIN(s2.captured_at) AS t FROM video_view_snapshots s2
             JOIN channel_videos v ON v.video_id = s2.video_id
             WHERE v.user_channel_id = ? GROUP BY s2.video_id) m
         ON m.video_id = s.video_id AND m.t = s.captured_at`,
    )
    .all(userChannelId) as { video_id: string; views: number }[];
  return new Map(rows.map((r) => [r.video_id, r.views]));
}

export type ListOptions = {
  userChannelId: string;
  tab: VideoTab;
  sort: VideoSort;
  timeFilter: TimeFilter;
  search?: string | null;
  searchMode?: string | null;
  limit: number;
  cursor?: string | null;
  minScore?: number | null;
  maxScore?: number | null;
};

export function listChannelVideos(opts: ListOptions) {
  const rows = channelDb()
    .prepare("SELECT * FROM channel_videos WHERE user_channel_id = ? AND type = ?")
    .all(opts.userChannelId, TAB_TO_KIND[opts.tab]) as ChannelVideoRow[];

  let periodViews: Map<string, number> | null = null;
  if (opts.timeFilter !== "all") {
    const cutoff = new Date(Date.now() - Number(opts.timeFilter) * 86_400_000).toISOString();
    const before = viewsAt(opts.userChannelId, cutoff);
    const first = earliestViews(opts.userChannelId);
    periodViews = new Map(
      rows.map((r) => {
        const publishedInPeriod = !!r.published_at && r.published_at >= cutoff;
        const baseline = before.get(r.video_id) ?? (publishedInPeriod ? 0 : (first.get(r.video_id) ?? r.views ?? 0));
        return [r.video_id, Math.max(0, (r.views ?? 0) - baseline)];
      }),
    );
  }

  const q = opts.search?.trim().toLowerCase();
  let list = rows;
  if (q) {
    const words = q.split(/\s+/).filter(Boolean);
    list = list.filter((r) => {
      const t = r.title.toLowerCase();
      return opts.searchMode === "exact" || !opts.searchMode ? t.includes(q) : words.every((w) => t.includes(w));
    });
  }
  if (opts.minScore != null || opts.maxScore != null) {
    const lo = opts.minScore ?? 0;
    const hi = opts.maxScore ?? Infinity;
    list = list.filter((r) => r.outlier_score != null && r.outlier_score >= lo && r.outlier_score <= hi);
  }

  const date = (r: ChannelVideoRow) => r.published_at ?? "";
  const views = (r: ChannelVideoRow) => (periodViews ? (periodViews.get(r.video_id) ?? 0) : (r.views ?? 0));
  const byLatest = (a: ChannelVideoRow, b: ChannelVideoRow) => date(b).localeCompare(date(a)) || a.video_id.localeCompare(b.video_id);
  const sorters: Record<VideoSort, (a: ChannelVideoRow, b: ChannelVideoRow) => number> = {
    latest: byLatest,
    oldest: (a, b) => -byLatest(a, b),
    popular: (a, b) => views(b) - views(a) || byLatest(a, b),
    unpopular: (a, b) => views(a) - views(b) || byLatest(a, b),
    outlier: (a, b) => (b.outlier_score ?? -1) - (a.outlier_score ?? -1) || byLatest(a, b),
  };
  list = [...list].sort(sorters[opts.sort]).slice(0, MAX_TOTAL);

  let start = 0;
  if (opts.cursor) {
    const at = list.findIndex((r) => r.video_id === opts.cursor);
    start = at >= 0 ? at + 1 : list.length;
  }
  const page = list.slice(start, start + opts.limit);
  const changed = videosWithChanges(page.map((r) => r.video_id));
  const hasMore = start + page.length < list.length;
  return {
    videos: page.map((r) =>
      toMyChannelVideo(r, { periodViews: periodViews ? (periodViews.get(r.video_id) ?? 0) : null, hasChanges: changed.has(r.video_id) }),
    ),
    nextCursor: hasMore && page.length ? page[page.length - 1].video_id : null,
    hasMore,
    maxTotal: MAX_TOTAL,
  };
}

export type ChannelSummary = {
  id: string;
  channelId: string;
  channelName: string;
  channelAvatar: string | null;
  channelUrl: string;
  handle: string | null;
  subscriberCount: number | null;
  videoCount: number;
  lastSyncedAt: string | null;
  hasShorts: boolean;
  hasLivestreams: boolean;
  firstSnapshotDate: string | null;
};

export function getChannelSummary(channel: UserChannel): ChannelSummary {
  const db = channelDb();
  const counts = db
    .prepare("SELECT type, count(*) AS n FROM channel_videos WHERE user_channel_id = ? GROUP BY type")
    .all(channel.id) as { type: string; n: number }[];
  const n = (t: string) => counts.find((c) => c.type === t)?.n ?? 0;
  const first = db
    .prepare(
      `SELECT MIN(s.captured_at) AS t FROM video_view_snapshots s
       JOIN channel_videos v ON v.video_id = s.video_id WHERE v.user_channel_id = ?`,
    )
    .get(channel.id) as { t: string | null } | undefined;
  return {
    id: channel.id,
    channelId: channel.channelId,
    channelName: channel.name ?? "Your channel",
    channelAvatar: channel.avatar,
    channelUrl: `https://www.youtube.com/channel/${channel.channelId}`,
    handle: channel.handle,
    subscriberCount: channel.subscriberCount,
    videoCount: counts.reduce((s, c) => s + c.n, 0),
    lastSyncedAt: channel.lastSyncedAt,
    hasShorts: n("shorts") > 0,
    hasLivestreams: n("live") > 0,
    firstSnapshotDate: first?.t ?? null,
  };
}

export function getChannelVideo(videoId: string) {
  const row = channelDb().prepare("SELECT * FROM channel_videos WHERE video_id = ?").get(videoId) as ChannelVideoRow | undefined;
  if (!row) return null;
  return { ...toMyChannelVideo(row, { hasChanges: videosWithChanges([videoId]).has(videoId) }), likes: row.likes, comments: row.comments, userChannelId: row.user_channel_id };
}

/** One point per UTC day (the day's last snapshot), oldest first. */
export function getViewHistory(videoId: string): { date: string; views: number; capturedAt: string }[] {
  const rows = channelDb()
    .prepare("SELECT captured_at, views FROM video_view_snapshots WHERE video_id = ? ORDER BY captured_at ASC")
    .all(videoId) as { captured_at: string; views: number }[];
  const byDay = new Map<string, { date: string; views: number; capturedAt: string }>();
  for (const r of rows) {
    const date = r.captured_at.slice(0, 10);
    byDay.set(date, { date, views: r.views, capturedAt: r.captured_at });
  }
  return [...byDay.values()];
}

export type VideoChange = {
  id: string;
  changeType: string;
  oldTitle: string | null;
  newTitle: string | null;
  oldThumbnail: string | null;
  newThumbnail: string | null;
  changedAt: string;
};

export function getChangeHistory(videoId: string): VideoChange[] {
  const rows = channelDb()
    .prepare("SELECT * FROM video_change_history WHERE video_id = ? ORDER BY changed_at DESC")
    .all(videoId) as Record<string, string | null>[];
  return rows.map((r) => ({
    id: r.id as string,
    changeType: r.change_type as string,
    oldTitle: r.old_title,
    newTitle: r.new_title,
    oldThumbnail: r.old_thumbnail,
    newThumbnail: r.new_thumbnail,
    changedAt: r.changed_at as string,
  }));
}
