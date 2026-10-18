import "server-only";
import type { SQLInputValue } from "node:sqlite";
import { appDb, newId, nowIso, tx } from "@/lib/db/app";
import { library, toOutlierVideo, type LibraryVideoRow, type OutlierVideo } from "@/lib/db/library";
import { publishWindowStart } from "@/lib/taxonomy";
import { NO_SCORE_CEILING, PAGE_SIZE, VIEWS_CEILING, parseChannelId } from "./filters";
import { enrichVideos } from "./app-data";
import { VIDEO_COLUMNS } from "./videos";
import { fetchChannelFeed, resolveChannel } from "./youtube";

// Following: lists of followed channels and a feed built from (a) library outliers
// of those channels and (b) their latest uploads from the public RSS feed, scored
// against each channel's average views.

export type ChannelInput = {
  channelId: string;
  channelName?: string | null;
  name?: string | null;
  handle?: string | null;
  channelAvatar?: string | null;
  avatar?: string | null;
  subscriberCount?: number | string | null;
};

export type FollowedChannel = {
  channelId: string;
  channelName: string;
  handle: string | null;
  channelAvatar: string | null;
  subscriberCount: number | null;
  addedAt: string;
  lastSyncedAt: string | null;
};

export type FollowingList = {
  id: string;
  name: string;
  type: string | null;
  createdAt: string;
  channelIds: string[];
  ChannelListItem: (FollowedChannel & { id: string })[];
};

type ChannelRow = {
  channel_id: string;
  name: string | null;
  handle: string | null;
  avatar: string | null;
  subscriber_count: number | null;
  added_at: string;
  last_synced_at: string | null;
};

const CHANNEL_ID_RE = /^UC[\w-]{22}$/;

function toChannel(r: ChannelRow): FollowedChannel {
  return {
    channelId: r.channel_id,
    channelName: r.name || r.channel_id,
    handle: r.handle,
    channelAvatar: r.avatar,
    subscriberCount: r.subscriber_count,
    addedAt: r.added_at,
    lastSyncedAt: r.last_synced_at,
  };
}

export function listFollowedChannels(): FollowedChannel[] {
  const rows = appDb().prepare("SELECT * FROM followed_channels ORDER BY name COLLATE NOCASE").all() as ChannelRow[];
  return rows.map(toChannel);
}

export function followedChannelIds(): string[] {
  return (appDb().prepare("SELECT channel_id FROM followed_channels").all() as { channel_id: string }[]).map((r) => r.channel_id);
}

export function listFollowingLists(): FollowingList[] {
  const db = appDb();
  const lists = db.prepare("SELECT * FROM following_lists ORDER BY created_at ASC, name COLLATE NOCASE").all() as {
    id: string;
    name: string;
    type: string | null;
    created_at: string;
  }[];
  const members = db
    .prepare(
      `SELECT lc.list_id, c.* FROM following_list_channels lc
       JOIN followed_channels c ON c.channel_id = lc.channel_id
       ORDER BY c.name COLLATE NOCASE`,
    )
    .all() as (ChannelRow & { list_id: string })[];
  return lists.map((l) => {
    const items = members.filter((m) => m.list_id === l.id).map((m) => ({ id: `${l.id}:${m.channel_id}`, ...toChannel(m) }));
    return { id: l.id, name: l.name, type: l.type, createdAt: l.created_at, channelIds: items.map((i) => i.channelId), ChannelListItem: items };
  });
}

export class FollowingError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
  }
}

function cleanListName(name: unknown): string {
  const value = typeof name === "string" ? name.trim().replace(/\s+/g, " ") : "";
  if (!value) throw new FollowingError("List name is required");
  if (value.length > 50) throw new FollowingError("List name must be 50 characters or fewer");
  return value;
}

export function createList(name: unknown, type: string | null = null): FollowingList {
  const clean = cleanListName(name);
  const db = appDb();
  const exists = db.prepare("SELECT 1 FROM following_lists WHERE name = ? COLLATE NOCASE").get(clean);
  if (exists) throw new FollowingError(`A list named "${clean}" already exists`, 409);
  const id = newId();
  db.prepare("INSERT INTO following_lists (id, name, type, created_at) VALUES (?, ?, ?, ?)").run(id, clean, type, nowIso());
  return listFollowingLists().find((l) => l.id === id)!;
}

export function renameList(id: string, name: unknown): FollowingList {
  const clean = cleanListName(name);
  const db = appDb();
  if (!db.prepare("SELECT 1 FROM following_lists WHERE id = ?").get(id)) throw new FollowingError("List not found", 404);
  const clash = db.prepare("SELECT 1 FROM following_lists WHERE name = ? COLLATE NOCASE AND id != ?").get(clean, id);
  if (clash) throw new FollowingError(`A list named "${clean}" already exists`, 409);
  db.prepare("UPDATE following_lists SET name = ? WHERE id = ?").run(clean, id);
  return listFollowingLists().find((l) => l.id === id)!;
}

export function deleteList(id: string) {
  const found = appDb().prepare("SELECT 1 FROM following_lists WHERE id = ?").get(id);
  if (!found) throw new FollowingError("List not found", 404);
  tx((db) => {
    db.prepare("DELETE FROM following_list_channels WHERE list_id = ?").run(id);
    db.prepare("DELETE FROM following_lists WHERE id = ?").run(id);
  });
}

function normalizeChannelInput(input: ChannelInput) {
  const channelId = typeof input.channelId === "string" ? input.channelId.trim() : "";
  if (!CHANNEL_ID_RE.test(channelId)) throw new FollowingError("A valid YouTube channel id (UC…) is required");
  const subs = input.subscriberCount == null ? null : Number(input.subscriberCount);
  return {
    channelId,
    name: (input.channelName ?? input.name ?? "").toString().trim() || null,
    handle: input.handle?.toString().trim() || null,
    avatar: (input.channelAvatar ?? input.avatar ?? "").toString().trim() || null,
    subscriberCount: subs != null && Number.isFinite(subs) ? Math.round(subs) : null,
  };
}

/** Follow (or refresh the details of) a channel. Fills the name from the library when missing. */
export function followChannel(input: ChannelInput): FollowedChannel {
  const c = normalizeChannelInput(input);
  const lib = library().prepare("SELECT channel_name, subscriber_count FROM channels WHERE channel_id = ?").get(c.channelId) as
    | { channel_name: string | null; subscriber_count: number | null }
    | undefined;
  appDb()
    .prepare(
      `INSERT INTO followed_channels (channel_id, name, handle, avatar, subscriber_count, added_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(channel_id) DO UPDATE SET
         name = COALESCE(excluded.name, followed_channels.name),
         handle = COALESCE(excluded.handle, followed_channels.handle),
         avatar = COALESCE(excluded.avatar, followed_channels.avatar),
         subscriber_count = COALESCE(excluded.subscriber_count, followed_channels.subscriber_count)`,
    )
    .run(c.channelId, c.name ?? lib?.channel_name ?? null, c.handle, c.avatar, c.subscriberCount ?? lib?.subscriber_count ?? null, nowIso());
  return getFollowedChannel(c.channelId)!;
}

export function getFollowedChannel(channelId: string): FollowedChannel | null {
  const row = appDb().prepare("SELECT * FROM followed_channels WHERE channel_id = ?").get(channelId) as ChannelRow | undefined;
  return row ? toChannel(row) : null;
}

/** Unfollow removes the channel from every list and drops its synced videos. */
export function unfollowChannel(channelId: string) {
  tx((db) => {
    db.prepare("DELETE FROM following_list_channels WHERE channel_id = ?").run(channelId);
    db.prepare("DELETE FROM followed_videos WHERE channel_id = ?").run(channelId);
    db.prepare("DELETE FROM followed_channels WHERE channel_id = ?").run(channelId);
  });
  syncState().failed.delete(channelId);
}

export function addChannelToList(listId: string, input: ChannelInput): FollowedChannel {
  if (!appDb().prepare("SELECT 1 FROM following_lists WHERE id = ?").get(listId)) throw new FollowingError("List not found", 404);
  const channel = followChannel(input);
  appDb().prepare("INSERT OR IGNORE INTO following_list_channels (list_id, channel_id) VALUES (?, ?)").run(listId, channel.channelId);
  return channel;
}

export function removeChannelFromList(listId: string, channelId: string) {
  appDb().prepare("DELETE FROM following_list_channels WHERE list_id = ? AND channel_id = ?").run(listId, channelId);
}

/** Data for the "Manage channels" dialog (original getFollowingChannelManagementData). */
export function channelManagementData() {
  const lists = listFollowingLists();
  const memberships = new Map<string, { id: string; name: string }[]>();
  for (const l of lists) {
    for (const id of l.channelIds) memberships.set(id, [...(memberships.get(id) ?? []), { id: l.id, name: l.name }]);
  }
  return {
    channels: listFollowedChannels().map((c) => ({ ...c, listMemberships: memberships.get(c.channelId) ?? [] })),
    lists: lists.map((l) => ({ id: l.id, name: l.name })),
  };
}

// ---------------------------------------------------------------------------
// Feed

export type FollowingVideosParams = {
  type: "longform" | "shorts";
  page: number;
  search: string;
  channelId: string | null;
  outlierMin: number;
  outlierMax: number;
  viewsMin: number;
  viewsMax: number;
  publishDate: string;
  excludePublishDate: string;
  listIds: string[];
  unlistedOnly: boolean;
};

export type FollowingVideo = OutlierVideo & { source: "library" | "feed" };

const num = (value: string | null, fallback: number) => {
  const n = value == null || value.trim() === "" ? Number.NaN : Number(value);
  return Number.isFinite(n) ? n : fallback;
};

export function parseFollowingParams(sp: URLSearchParams): FollowingVideosParams {
  return {
    type: sp.get("type") === "shorts" ? "shorts" : "longform",
    page: Math.min(1000, Math.max(0, Math.floor(num(sp.get("page"), 0)))),
    search: (sp.get("search") ?? "").trim().slice(0, 200),
    channelId: parseChannelId(sp.get("channel")),
    outlierMin: Math.max(0, num(sp.get("outlierMin"), 0)),
    outlierMax: num(sp.get("outlierMax"), NO_SCORE_CEILING),
    viewsMin: Math.max(0, num(sp.get("viewsMin"), 0)),
    viewsMax: num(sp.get("viewsMax"), VIEWS_CEILING),
    publishDate: sp.get("publishDate") ?? "all",
    excludePublishDate: sp.get("excludePublishDate") ?? "all",
    listIds: (sp.get("listIds") ?? "").split(",").map((s) => s.trim()).filter(Boolean),
    unlistedOnly: sp.get("unlistedOnly") === "true",
  };
}

/** Channel ids in scope for the feed: everything followed, chosen lists, or channels in no list. */
export function scopeChannelIds(p: Pick<FollowingVideosParams, "listIds" | "unlistedOnly" | "channelId">): string[] {
  const db = appDb();
  let ids: string[];
  if (p.listIds.length) {
    ids = (
      db
        .prepare("SELECT DISTINCT channel_id FROM following_list_channels WHERE list_id IN (SELECT value FROM json_each(?))")
        .all(JSON.stringify(p.listIds)) as { channel_id: string }[]
    ).map((r) => r.channel_id);
  } else if (p.unlistedOnly) {
    ids = (
      db
        .prepare("SELECT channel_id FROM followed_channels WHERE channel_id NOT IN (SELECT channel_id FROM following_list_channels)")
        .all() as { channel_id: string }[]
    ).map((r) => r.channel_id);
  } else {
    ids = followedChannelIds();
  }
  return p.channelId ? ids.filter((id) => id === p.channelId) : ids;
}

type FeedRow = {
  video_id: string;
  channel_id: string;
  channel_name: string | null;
  title: string;
  thumbnail: string | null;
  views: number | null;
  published_at: string | null;
  duration_seconds: number | null;
  is_short: number;
  outlier_score: number | null;
  subscriber_count: number | null;
};

function feedRowToVideo(r: FeedRow): FollowingVideo {
  return {
    id: r.video_id,
    videoId: r.video_id,
    title: r.title,
    titleLength: r.title.length,
    videoUrl: r.is_short ? `https://www.youtube.com/shorts/${r.video_id}` : `https://www.youtube.com/watch?v=${r.video_id}`,
    thumbnail: r.thumbnail ?? `https://i.ytimg.com/vi/${r.video_id}/hqdefault.jpg`,
    channelId: r.channel_id,
    channelName: r.channel_name,
    subscriberCount: r.subscriber_count,
    views: r.views,
    outlierScore: r.outlier_score,
    publishAt: r.published_at,
    duration: null,
    durationSeconds: r.duration_seconds,
    isShort: !!r.is_short,
    frame: null,
    secondaryFrame: null,
    pov: null,
    featuredInNewsletter: false,
    niches: [],
    clickTriggers: [],
    videoTypes: [],
    isBookmarked: false,
    bookmarkTags: [],
    projectIds: [],
    source: "feed",
  };
}

export function queryFollowingVideos(p: FollowingVideosParams) {
  const channels = scopeChannelIds(p);
  const totalChannels = channels.length;
  if (!channels.length) return { success: true as const, videos: [] as FollowingVideo[], hasMore: false, page: p.page, totalChannels };

  const take = (p.page + 1) * PAGE_SIZE + 1;
  const scope = JSON.stringify(channels);
  const from = publishWindowStart(p.publishDate);
  const notAfter = publishWindowStart(p.excludePublishDate);

  const filters = (cols: { short: string; score: string; views: string; date: string; title: string }) => {
    const sql: string[] = [];
    const params: SQLInputValue[] = [];
    const add = (clause: string, value: SQLInputValue) => {
      sql.push(clause);
      params.push(value);
    };
    add(`${cols.short} = ?`, p.type === "shorts" ? 1 : 0);
    if (p.outlierMin > 0) add(`${cols.score} >= ?`, p.outlierMin);
    if (p.outlierMax < NO_SCORE_CEILING) add(`${cols.score} < ?`, p.outlierMax);
    if (p.viewsMin > 0) add(`${cols.views} >= ?`, p.viewsMin);
    if (p.viewsMax < VIEWS_CEILING) add(`${cols.views} <= ?`, p.viewsMax);
    if (from) add(`${cols.date} >= ?`, from);
    if (notAfter) add(`${cols.date} < ?`, notAfter);
    if (p.search) add(`instr(lower(${cols.title}), lower(?)) > 0`, p.search);
    return { sql: sql.join(" AND "), params };
  };

  const libFilter = filters({ short: "v.is_short", score: "v.outlier_score", views: "v.views", date: "v.publish_at", title: "v.title" });
  const libRows = library()
    .prepare(
      `SELECT ${VIDEO_COLUMNS} FROM videos v
       WHERE v.channel_id IN (SELECT value FROM json_each(?)) AND ${libFilter.sql}
       ORDER BY v.publish_at DESC LIMIT ?`,
    )
    .all(scope, ...libFilter.params, take) as LibraryVideoRow[];

  const feedFilter = filters({ short: "f.is_short", score: "f.outlier_score", views: "f.views", date: "f.published_at", title: "f.title" });
  const feedRows = appDb()
    .prepare(
      `SELECT f.*, c.subscriber_count FROM followed_videos f
       LEFT JOIN followed_channels c ON c.channel_id = f.channel_id
       WHERE f.channel_id IN (SELECT value FROM json_each(?)) AND ${feedFilter.sql}
       ORDER BY f.published_at DESC LIMIT ?`,
    )
    .all(scope, ...feedFilter.params, take) as FeedRow[];

  const byId = new Map<string, FollowingVideo>();
  for (const r of libRows) byId.set(r.video_id, { ...toOutlierVideo(r), source: "library" });
  for (const r of feedRows) if (!byId.has(r.video_id)) byId.set(r.video_id, feedRowToVideo(r));
  const merged = [...byId.values()].sort((a, b) => (b.publishAt ?? "").localeCompare(a.publishAt ?? ""));
  const start = p.page * PAGE_SIZE;
  return {
    success: true as const,
    videos: enrichVideos(merged.slice(start, start + PAGE_SIZE)),
    hasMore: merged.length > start + PAGE_SIZE,
    page: p.page,
    totalChannels,
  };
}

// ---------------------------------------------------------------------------
// Sync (RSS)

type SyncState = { running: Set<string>; failed: Map<string, string>; lastFinishedAt: string | null };
const g = globalThis as unknown as { __hooklabFollowingSync?: SyncState };
function syncState(): SyncState {
  g.__hooklabFollowingSync ??= { running: new Set(), failed: new Map(), lastFinishedAt: null };
  return g.__hooklabFollowingSync;
}

const STALE_MS = 30 * 60_000;
const SYNC_CONCURRENCY = 4;

/**
 * Average views a channel's videos get: implied by the library (views / outlier score, median)
 * when the channel has library rows, otherwise the mean of its settled feed uploads of that type.
 */
function channelAverage(channelId: string, feed: { views: number | null; isShort: boolean; publishedAt: string | null }[], shorts: boolean) {
  if (!shorts) {
    const implied = (
      library()
        .prepare("SELECT views * 1.0 / outlier_score AS avg FROM videos WHERE channel_id = ? AND outlier_score > 0 AND views > 0 AND is_short = 0")
        .all(channelId) as { avg: number }[]
    )
      .map((r) => r.avg)
      .sort((a, b) => a - b);
    if (implied.length) return implied[Math.floor(implied.length / 2)];
  }
  const settled = Date.now() - 3 * 86_400_000;
  const same = feed.filter((v) => v.isShort === shorts && v.views != null);
  const old = same.filter((v) => v.publishedAt && Date.parse(v.publishedAt) < settled);
  const pool = old.length >= 3 ? old : same;
  if (!pool.length) return null;
  return pool.reduce((s, v) => s + (v.views ?? 0), 0) / pool.length;
}

export async function syncChannel(channelId: string) {
  const state = syncState();
  state.running.add(channelId);
  try {
    const { channelName, videos } = await fetchChannelFeed(channelId);
    const db = appDb();
    const now = nowIso();
    const avgLong = channelAverage(channelId, videos, false);
    const avgShort = channelAverage(channelId, videos, true);
    tx((d) => {
      const upsert = d.prepare(
        `INSERT INTO followed_videos (video_id, channel_id, channel_name, title, thumbnail, views, published_at, duration_seconds, is_short, outlier_score, raw, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?)
         ON CONFLICT(video_id) DO UPDATE SET title = excluded.title, views = excluded.views, channel_name = excluded.channel_name,
           is_short = excluded.is_short, outlier_score = excluded.outlier_score, raw = excluded.raw, updated_at = excluded.updated_at`,
      );
      for (const v of videos) {
        const avg = v.isShort ? avgShort : avgLong;
        const score = v.views != null && avg ? Math.round((v.views / avg) * 100) / 100 : null;
        upsert.run(v.videoId, channelId, v.channelName, v.title, v.thumbnail, v.views, v.publishedAt, v.isShort ? 1 : 0, score, JSON.stringify(v), now);
      }
      d.prepare("UPDATE followed_channels SET last_synced_at = ?, name = COALESCE(name, ?) WHERE channel_id = ?").run(now, channelName, channelId);
    });
    // One-time enrichment: avatar / handle / subscribers from the public channel page.
    const row = db.prepare("SELECT avatar, subscriber_count FROM followed_channels WHERE channel_id = ?").get(channelId) as
      | { avatar: string | null; subscriber_count: number | null }
      | undefined;
    if (row && (!row.avatar || row.subscriber_count == null)) {
      const info = await resolveChannel(channelId).catch(() => null);
      if (info) {
        db.prepare(
          "UPDATE followed_channels SET avatar = COALESCE(avatar, ?), handle = COALESCE(handle, ?), subscriber_count = COALESCE(subscriber_count, ?), name = COALESCE(name, ?) WHERE channel_id = ?",
        ).run(info.avatar, info.handle, info.subscriberCount, info.name, channelId);
      }
    }
    state.failed.delete(channelId);
  } catch (err) {
    state.failed.set(channelId, err instanceof Error ? err.message : "Sync failed");
  } finally {
    state.running.delete(channelId);
    if (!state.running.size) state.lastFinishedAt = nowIso();
  }
}

/** Queue RSS syncs (fire-and-forget). With onlyStale, channels synced in the last 30 minutes are skipped. */
export function startSync(opts: { channelIds?: string[]; onlyStale?: boolean; onlyFailed?: boolean } = {}) {
  const state = syncState();
  const followed = listFollowedChannels();
  let targets = opts.channelIds?.length ? followed.filter((c) => opts.channelIds!.includes(c.channelId)) : followed;
  if (opts.onlyFailed) targets = targets.filter((c) => state.failed.has(c.channelId));
  if (opts.onlyStale) targets = targets.filter((c) => !c.lastSyncedAt || Date.now() - Date.parse(c.lastSyncedAt) > STALE_MS);
  const queue = targets.map((c) => c.channelId).filter((id) => !state.running.has(id));
  for (const id of queue) state.running.add(id);
  const worker = async () => {
    for (let id = queue.shift(); id; id = queue.shift()) await syncChannel(id);
  };
  const count = queue.length;
  void Promise.all(Array.from({ length: Math.min(SYNC_CONCURRENCY, count) }, worker));
  return { queued: count };
}

export function syncStatus() {
  const state = syncState();
  const followed = listFollowedChannels();
  const ids = new Set(followed.map((c) => c.channelId));
  const failed = [...state.failed.entries()].filter(([id]) => ids.has(id));
  return {
    success: true as const,
    syncing: state.running.size > 0,
    syncingCount: state.running.size,
    total: followed.length,
    failedCount: failed.length,
    failed: failed.map(([channelId, error]) => ({ channelId, error })),
    lastSyncedAt: followed.reduce<string | null>((max, c) => (c.lastSyncedAt && (!max || c.lastSyncedAt > max) ? c.lastSyncedAt : max), null),
  };
}
