// In-memory index of the library's channels: the `channels` aggregate table (rebuilt with the
// export and kept current per channel by the refresh pipeline) merged with the channels added
// with `hooklab library add` (library_channels). Also resolves "UC…", "@handle", URLs and names.
import type { DatabaseSync } from "node:sqlite";
import { QueryError } from "./errors.ts";
import { cached } from "./library.ts";
import { looseKey } from "./taxonomy.ts";

export type ChannelRecord = {
  channelId: string;
  channelName: string | null;
  handle: string | null;
  channelUrl: string;
  avatar: string | null;
  subscriberCount: number | null;
  videoCount: number;
  totalViews: number | null;
  avgOutlierScore: number | null;
  maxOutlierScore: number | null;
  latestPublishAt: string | null;
  /** Added to the library from YouTube (library_channels), so the refresh pipeline follows it. */
  tracked: boolean;
  addedAt: string | null;
  lastSyncedAt: string | null;
  lastError: string | null;
};

type AggRow = {
  channel_id: string;
  channel_name: string | null;
  subscriber_count: number | null;
  video_count: number;
  avg_outlier_score: number | null;
  max_outlier_score: number | null;
  total_views: number | null;
  latest_publish_at: string | null;
};

type LibraryChannelRow = {
  channel_id: string;
  handle: string | null;
  name: string | null;
  avatar: string | null;
  subscriber_count: number | null;
  added_at: string | null;
  last_synced_at: string | null;
  last_error: string | null;
};

export type ChannelIndex = {
  list: ChannelRecord[];
  byId: Map<string, ChannelRecord>;
};

const CHANNEL_ID = /^UC[\w-]{22}$/;

const normHandle = (h: string) => h.trim().replace(/^@/, "").toLowerCase();

function hasTable(db: DatabaseSync, name: string): boolean {
  return !!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name);
}

function build(db: DatabaseSync): ChannelIndex {
  const byId = new Map<string, ChannelRecord>();
  const put = (r: AggRow) => {
    byId.set(r.channel_id, {
      channelId: r.channel_id,
      channelName: r.channel_name,
      handle: null,
      channelUrl: `https://www.youtube.com/channel/${r.channel_id}`,
      avatar: null,
      subscriberCount: r.subscriber_count,
      videoCount: Number(r.video_count ?? 0),
      totalViews: r.total_views,
      avgOutlierScore: r.avg_outlier_score,
      maxOutlierScore: r.max_outlier_score,
      latestPublishAt: r.latest_publish_at,
      tracked: false,
      addedAt: null,
      lastSyncedAt: null,
      lastError: null,
    });
  };

  for (const r of db
    .prepare(
      `SELECT channel_id, channel_name, subscriber_count, video_count, avg_outlier_score, max_outlier_score,
              total_views, latest_publish_at FROM channels WHERE channel_id IS NOT NULL`,
    )
    .all() as AggRow[]) {
    put(r);
  }

  const tracked = hasTable(db, "library_channels")
    ? (db.prepare("SELECT * FROM library_channels").all() as LibraryChannelRow[])
    : [];

  for (const t of tracked) {
    let rec = byId.get(t.channel_id);
    if (!rec) {
      put({
        channel_id: t.channel_id,
        channel_name: t.name,
        subscriber_count: t.subscriber_count,
        video_count: 0,
        avg_outlier_score: null,
        max_outlier_score: null,
        total_views: null,
        latest_publish_at: null,
      });
      rec = byId.get(t.channel_id)!;
    }
    rec.tracked = true;
    rec.handle = t.handle?.trim() ? `@${t.handle.trim().replace(/^@/, "")}` : null;
    rec.channelName = rec.channelName ?? t.name;
    rec.avatar = t.avatar;
    rec.subscriberCount = t.subscriber_count ?? rec.subscriberCount;
    rec.addedAt = t.added_at;
    rec.lastSyncedAt = t.last_synced_at;
    rec.lastError = t.last_error;
    if (rec.handle) rec.channelUrl = `https://www.youtube.com/${rec.handle}`;
  }

  return { list: [...byId.values()], byId };
}

export function channelIndex(db: DatabaseSync): ChannelIndex {
  return cached(db, "channel-index", 30_000, () => build(db));
}

// ------------------------------------------------------------------ resolution

export type ChannelRef = { kind: "id"; id: string } | { kind: "handle"; handle: string } | { kind: "name"; name: string };

/** "UC…", "@handle", a youtube.com channel URL, or a channel name. */
export function parseChannelRef(input: string): ChannelRef {
  const s = input.trim();
  if (CHANNEL_ID.test(s)) return { kind: "id", id: s };
  if (/^@[\p{L}\p{N}_.\-·]+$/u.test(s)) return { kind: "handle", handle: normHandle(s) };
  if (/^(https?:\/\/)?([\w-]+\.)*youtube\.com\//i.test(s)) {
    let url: URL | null = null;
    try {
      url = new URL(/^https?:/i.test(s) ? s : `https://${s}`);
    } catch {
      url = null;
    }
    if (url) {
      const [first, second] = url.pathname.split("/").filter(Boolean).map(decodeURIComponent);
      if (first === "channel" && second && CHANNEL_ID.test(second)) return { kind: "id", id: second };
      if (first?.startsWith("@")) return { kind: "handle", handle: normHandle(first) };
      if ((first === "c" || first === "user") && second) return { kind: "name", name: second };
    }
  }
  return { kind: "name", name: s };
}

export type ChannelMatch = { channel: ChannelRecord; matchedBy: "id" | "handle" | "name" };

const byVideos = (a: ChannelRecord, b: ChannelRecord) => b.videoCount - a.videoCount || (b.subscriberCount ?? 0) - (a.subscriberCount ?? 0);

/**
 * Find a channel. Names match exactly (ignoring case, spacing and punctuation) or, failing that,
 * as a unique substring; ambiguous names throw with up to 8 candidates in `details`.
 */
export function findChannel(db: DatabaseSync, input: string): ChannelMatch | null {
  const ref = parseChannelRef(input);
  const idx = channelIndex(db);
  if (ref.kind === "id") {
    const hit = idx.byId.get(ref.id);
    if (hit) return { channel: hit, matchedBy: "id" };
    // A channel present in videos but not yet aggregated (e.g. a refresh between rebuilds).
    const row = db.prepare("SELECT channel_name FROM videos WHERE channel_id = ? LIMIT 1").get(ref.id) as { channel_name: string | null } | undefined;
    if (!row) return null;
    return { channel: liveAggregate(db, ref.id), matchedBy: "id" };
  }
  if (ref.kind === "handle") {
    const exact = idx.list.find((c) => c.handle && normHandle(c.handle) === ref.handle);
    if (exact) return { channel: exact, matchedBy: "handle" };
    // Handles usually spell the channel name without spaces ("@AIEngineer" ↔ "AI Engineer").
    const key = looseKey(ref.handle);
    const byName = idx.list.filter((c) => c.channelName && looseKey(c.channelName) === key).sort(byVideos);
    return byName[0] ? { channel: byName[0], matchedBy: "handle" } : null;
  }
  const key = looseKey(ref.name);
  if (!key) return null;
  const exact = idx.list.filter((c) => c.channelName && looseKey(c.channelName) === key).sort(byVideos);
  if (exact[0]) return { channel: exact[0], matchedBy: "name" };
  const partial = idx.list.filter((c) => c.channelName && looseKey(c.channelName).includes(key)).sort(byVideos);
  if (partial.length === 1) return { channel: partial[0], matchedBy: "name" };
  if (partial.length > 1) {
    throw new QueryError(
      `"${input}" matches ${partial.length} channels. Use the channel id or the exact name: ${partial
        .slice(0, 5)
        .map((c) => `${c.channelName} (${c.channelId})`)
        .join(", ")}${partial.length > 5 ? ", …" : ""}.`,
      {
        code: "ambiguous_channel",
        details: { candidates: partial.slice(0, 8).map((c) => ({ channelId: c.channelId, channelName: c.channelName, videoCount: c.videoCount })) },
      },
    );
  }
  return null;
}

function liveAggregate(db: DatabaseSync, channelId: string): ChannelRecord {
  const r = db
    .prepare(
      `SELECT max(channel_name) AS channel_name, max(subscriber_count) AS subscriber_count, count(*) AS video_count,
              avg(outlier_score) AS avg_outlier_score, max(outlier_score) AS max_outlier_score, sum(views) AS total_views,
              max(publish_at) AS latest_publish_at
       FROM videos WHERE channel_id = ?`,
    )
    .get(channelId) as Omit<AggRow, "channel_id">;
  return {
    channelId,
    channelName: r.channel_name,
    handle: null,
    channelUrl: `https://www.youtube.com/channel/${channelId}`,
    avatar: null,
    subscriberCount: r.subscriber_count,
    videoCount: Number(r.video_count ?? 0),
    totalViews: r.total_views,
    avgOutlierScore: r.avg_outlier_score,
    maxOutlierScore: r.max_outlier_score,
    latestPublishAt: r.latest_publish_at,
    tracked: false,
    addedAt: null,
    lastSyncedAt: null,
    lastError: null,
  };
}

/** Channel ids for a `channelId` filter value: ids pass through; handles, URLs and names are resolved. */
export function resolveChannelFilter(db: DatabaseSync, input: string): string {
  const ref = parseChannelRef(input);
  if (ref.kind === "id") return ref.id;
  const match = findChannel(db, input);
  if (!match) {
    throw new QueryError(`No channel in the library matches "${input}". Try \`hooklab channels ${input.replace(/^@/, "")}\`.`, {
      code: "channel_not_found",
    });
  }
  return match.channel.channelId;
}
