// Channel listing and lookup for the CLI and /api/v1 (keyset-paginated over the channel index).
import { channelIndex, findChannel, type ChannelMatch, type ChannelRecord } from "./channel-index.ts";
import { cursorMismatch, decodeCursor, encodeCursor, queryHash, type CursorKey } from "./cursor.ts";
import { QueryError } from "./errors.ts";
import { libraryDb } from "./library.ts";
import { TIERS, looseKey, tierForScore, titleFormatForFrame } from "./taxonomy.ts";
import { asString, parseBoolean, parseInteger, type ParamValue } from "./values.ts";
import { searchVideos, type VideoRecord } from "./videos.ts";

export type { ChannelRecord } from "./channel-index.ts";

export type ChannelSort = "videos" | "subscribers" | "outlier" | "avgOutlier" | "views" | "latest" | "name";
export const CHANNEL_SORTS: ChannelSort[] = ["videos", "subscribers", "outlier", "avgOutlier", "views", "latest", "name"];

export type ChannelListInput = {
  /** Matches channel names and handles (case, spacing and punctuation ignored). */
  q?: ParamValue;
  sort?: ParamValue;
  /** Only channels added with `hooklab library add` (followed by the refresh pipeline). */
  tracked?: ParamValue;
  limit?: ParamValue;
  cursor?: ParamValue;
};

export const CHANNEL_QUERY_PARAMS = ["q", "sort", "tracked", "limit", "cursor"] as const;

export type ChannelPage = { data: ChannelRecord[]; nextCursor: string | null; hasMore: boolean; total: number; sort: ChannelSort };

const SORT_KEY: Record<ChannelSort, (c: ChannelRecord) => string | number> = {
  videos: (c) => c.videoCount,
  subscribers: (c) => c.subscriberCount ?? -1,
  outlier: (c) => c.maxOutlierScore ?? -1,
  avgOutlier: (c) => c.avgOutlierScore ?? -1,
  views: (c) => c.totalViews ?? -1,
  latest: (c) => c.latestPublishAt ?? "",
  name: (c) => (c.channelName ?? "").toLowerCase(),
};

/** -1 when a sorts before b. Every sort is descending except name; ties break on channelId. */
function compareKeys(sort: ChannelSort, a: { k: CursorKey; id: string }, b: { k: CursorKey; id: string }): number {
  if (a.k !== b.k) {
    const before = (a.k ?? "") > (b.k ?? "");
    return sort === "name" ? (before ? 1 : -1) : before ? -1 : 1;
  }
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

export function listChannels(input: ChannelListInput = {}): ChannelPage {
  const db = libraryDb();
  const q = asString(input.q)?.slice(0, 200) ?? null;
  const sortRaw = asString(input.sort);
  const sort = sortRaw ? CHANNEL_SORTS.find((s) => s.toLowerCase() === sortRaw.toLowerCase().replace(/[^a-z]/g, "")) : "videos";
  if (!sort) throw new QueryError(`sort must be one of: ${CHANNEL_SORTS.join(", ")} (got "${sortRaw}").`);
  const tracked = parseBoolean("tracked", input.tracked) ?? false;
  const limit = parseInteger("limit", input.limit, { min: 1, max: 1000, fallback: 50, clamp: true });
  const hash = queryHash({ kind: "channels", q: q?.toLowerCase() ?? null, sort, tracked });

  const key = q ? looseKey(q) : "";
  const keyOf = SORT_KEY[sort];
  const rows = channelIndex(db)
    .list.filter((c) => !tracked || c.tracked)
    .filter((c) => !key || looseKey(c.channelName ?? "").includes(key) || (c.handle ? looseKey(c.handle).includes(key) : false))
    .map((c) => ({ c, k: keyOf(c) as CursorKey, id: c.channelId }))
    .sort((a, b) => compareKeys(sort, a, b));

  let start = 0;
  const cursorRaw = asString(input.cursor);
  if (cursorRaw) {
    const cursor = decodeCursor(cursorRaw);
    if (cursor.h !== hash) throw cursorMismatch();
    const after = { k: cursor.k[0] ?? null, id: cursor.id };
    start = rows.findIndex((r) => compareKeys(sort, r, after) > 0);
    if (start < 0) start = rows.length;
  }
  const page = rows.slice(start, start + limit);
  const hasMore = start + limit < rows.length;
  const last = page[page.length - 1];
  return {
    data: page.map((r) => ({ ...r.c })),
    nextCursor: hasMore && last ? encodeCursor({ v: 1, h: hash, k: [last.k], id: last.id, f: {} }) : null,
    hasMore,
    total: rows.length,
    sort,
  };
}

export type ChannelBreakdown = {
  byTier: { id: string; label: string; count: number }[];
  medianOutlierScore: number | null;
  topNiches: { niche: string; count: number }[];
  topTriggers: { trigger: string; count: number }[];
  titleFormats: { titleFormat: string; count: number }[];
  firstPublishAt: string | null;
};

export type ChannelDetail = {
  channel: ChannelRecord;
  matchedBy: ChannelMatch["matchedBy"];
  breakdown: ChannelBreakdown;
  topVideos: Partial<VideoRecord>[];
};

function tally(values: string[], max: number): { value: string; count: number }[] {
  const m = new Map<string, number>();
  for (const v of values) m.set(v, (m.get(v) ?? 0) + 1);
  return [...m.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, max)
    .map(([value, count]) => ({ value, count }));
}

function breakdown(channelId: string): ChannelBreakdown {
  const rows = libraryDb()
    .prepare("SELECT outlier_score, niches, click_triggers, frame, publish_at FROM videos WHERE channel_id = ?")
    .all(channelId) as { outlier_score: number | null; niches: string | null; click_triggers: string | null; frame: string | null; publish_at: string | null }[];
  const parse = (s: string | null) => {
    try {
      const v = s ? JSON.parse(s) : [];
      return Array.isArray(v) ? (v as unknown[]).map(String) : [];
    } catch {
      return [];
    }
  };
  const scores = rows.map((r) => r.outlier_score).filter((s): s is number => s != null).sort((a, b) => a - b);
  const median = scores.length ? (scores.length % 2 ? scores[(scores.length - 1) / 2] : (scores[scores.length / 2 - 1] + scores[scores.length / 2]) / 2) : null;
  const tiers = new Map<string, number>();
  for (const s of scores) {
    const t = tierForScore(s);
    if (t) tiers.set(t.id, (tiers.get(t.id) ?? 0) + 1);
  }
  const dates = rows.map((r) => r.publish_at).filter((d): d is string => !!d).sort();
  return {
    byTier: TIERS.map((t) => ({ id: t.id, label: t.label, count: tiers.get(t.id) ?? 0 })),
    medianOutlierScore: median,
    topNiches: tally(rows.flatMap((r) => parse(r.niches)), 5).map((x) => ({ niche: x.value, count: x.count })),
    topTriggers: tally(rows.flatMap((r) => parse(r.click_triggers)), 8).map((x) => ({ trigger: x.value, count: x.count })),
    titleFormats: tally(rows.map((r) => titleFormatForFrame(r.frame)).filter((f): f is string => !!f), 7).map((x) => ({
      titleFormat: x.value,
      count: x.count,
    })),
    firstPublishAt: dates[0] ?? null,
  };
}

/** A channel by id ("UC…"), @handle, channel URL or name, with its top videos by outlier score. */
export function getChannel(ref: string, opts: { videos?: ParamValue } = {}): ChannelDetail | null {
  const videos = parseInteger("videos", opts.videos, { min: 0, max: 100, fallback: 10, clamp: true });
  const db = libraryDb();
  const match = findChannel(db, ref);
  if (!match) return null;
  const top = videos > 0 && match.channel.videoCount > 0 ? searchVideos({ channelId: match.channel.channelId, sort: "outlier", limit: videos }).data : [];
  return { channel: match.channel, matchedBy: match.matchedBy, breakdown: breakdown(match.channel.channelId), topVideos: top };
}

