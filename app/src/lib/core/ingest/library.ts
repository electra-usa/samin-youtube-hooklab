// Library management: add a channel by @handle, URL or UC id, back it up with its recent
// uploads, list, remove and sync. Added channels live in library_channels (kept by bulk
// rebuilds) and get user-added priority in the refresh rotation.
import { libraryReader } from "./reader.ts";
import { applyChannelPoll, refreshChannelAggregate, type ApplyStats, type PolledVideo } from "./apply.ts";
import { pollChannel } from "./poll.ts";
import { fetchFeed } from "./rss.ts";
import { scCanSpend, scChannel, scChannelVideos, type ScVideo } from "./scrapecreators.ts";
import { ingestSettings } from "./settings.ts";
import { CHANNEL_ID_RE, errorMessage, mapLimit, nowIso } from "./util.ts";
import { channelPathForVideo, fetchChannelPage, fetchChannelPageResult, fetchWatchPageDetails, parseChannelRef, type ChannelIdentity } from "./youtube-page.ts";
import { createLibraryWriter } from "./writer.ts";

export class LibraryError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "LibraryError";
    this.status = status;
  }
}

export type LibraryChannel = {
  channelId: string;
  handle: string | null;
  name: string | null;
  avatar: string | null;
  subscriberCount: number | null;
  addedAt: string;
  lastSyncedAt: string | null;
  lastError: string | null;
  source: "user" | "discovered";
  videos: number;
  outliers: number;
  lastPolledAt: string | null;
  lastUploadAt: string | null;
};

/** Resolve user input to a channel identity: free sources first, ScrapeCreators as the fallback. */
export async function resolveChannel(input: string, signal?: AbortSignal): Promise<ChannelIdentity> {
  const ref = parseChannelRef(input);
  if (!ref) throw new LibraryError(400, `"${input}" is not a YouTube channel id, @handle or URL.`);
  let identity: ChannelIdentity | null = null;
  if (ref.kind === "id") {
    const feed = await fetchFeed(ref.channelId, "all", signal);
    if (!feed.ok && feed.missing) throw new LibraryError(404, `YouTube has no channel ${ref.channelId}.`);
    identity = await fetchChannelPage(ref.channelId, signal);
    identity ??= { channelId: ref.channelId, name: feed.ok ? feed.channelName : null, handle: null, avatar: null, subscriberCount: null };
  } else if (ref.kind === "video") {
    const path = await channelPathForVideo(ref.videoId, signal);
    if (path) identity = await fetchChannelPage(path, signal);
  } else {
    const page = await fetchChannelPageResult(ref.kind === "handle" ? ref.handle : ref.path, signal);
    // YouTube itself says there's no such channel: don't spend a credit asking ScrapeCreators.
    if (page.status === 404) throw new LibraryError(404, `YouTube has no channel at "${input}".`);
    identity = page.identity;
  }
  const needsSc = !identity || identity.subscriberCount == null;
  if (needsSc && scCanSpend()) {
    try {
      const sc =
        identity?.channelId != null
          ? await scChannel({ channelId: identity.channelId }, { signal })
          : ref.kind === "handle"
            ? await scChannel({ handle: ref.handle }, { signal })
            : ref.kind === "path"
              ? await scChannel({ url: `https://www.youtube.com/${ref.path}` }, { signal })
              : null;
      if (sc) {
        identity = {
          channelId: sc.channelId,
          name: identity?.name ?? sc.name,
          handle: identity?.handle ?? sc.handle,
          avatar: identity?.avatar ?? sc.avatar,
          subscriberCount: sc.subscriberCount ?? identity?.subscriberCount ?? null,
        };
      }
    } catch {
      // Keep whatever the free sources found.
    }
  }
  if (!identity || !CHANNEL_ID_RE.test(identity.channelId)) throw new LibraryError(404, `Couldn't find a YouTube channel for "${input}".`);
  return identity;
}

export type BackfillResult = { channelId: string; videos: number; newVideos: number; updatedVideos: number; outliers: number; deep: boolean; error: string | null };

/** Poll a channel's feeds now (plus one ScrapeCreators page of ~30 uploads when `deep`) and store everything. */
export async function backfillChannel(channelId: string, opts: { deep?: boolean; signal?: AbortSignal } = {}): Promise<BackfillResult> {
  const poll = await pollChannel({ channelId, hasShorts: null, shortsCheckedAt: null }, { shorts: ingestSettings().shorts, signal: opts.signal });
  let deep = false;
  if (opts.deep && scCanSpend()) {
    try {
      const listing = await scChannelVideos(channelId, { signal: opts.signal });
      // The listing's times are relative ("1 year ago"); watch pages have the exact ones (free).
      const inFeed = new Set(poll.videos.map((v) => v.videoId));
      const exact = new Map<string, string>();
      await mapLimit(listing.filter((i) => !inFeed.has(i.videoId)).slice(0, 20), 3, async (item) => {
        const details = await fetchWatchPageDetails(item.videoId, opts.signal);
        if (details?.publishedAt) exact.set(item.videoId, details.publishedAt);
      });
      poll.videos = mergeListing(poll.videos, listing, poll.channelName, exact);
      deep = true;
    } catch (err) {
      poll.error ??= `ScrapeCreators listing: ${errorMessage(err)}`;
    }
  }
  const writer = createLibraryWriter();
  const now = nowIso();
  const stats: ApplyStats = writer.write((db) => applyChannelPoll(db, poll, { now }));
  await writer.settle();
  return {
    channelId,
    videos: poll.videos.length,
    newVideos: stats.newVideos,
    updatedVideos: stats.updatedVideos,
    outliers: stats.newOutliers,
    deep,
    error: poll.missing ? poll.error : poll.videos.length ? null : poll.error,
  };
}

/**
 * Combine RSS entries (exact times and views) with a ScrapeCreators listing (newest first,
 * exact views and lengths, relative times): listing-only videos use the exact time from their
 * watch page when known, else the listing's estimate clamped to keep the listing order.
 */
function mergeListing(rss: PolledVideo[], listing: ScVideo[], channelName: string | null, exact: Map<string, string>): PolledVideo[] {
  const byId = new Map(rss.map((v) => [v.videoId, v]));
  const out = [...rss];
  let ceiling: string | null = null;
  for (const item of listing) {
    const known = byId.get(item.videoId);
    if (known) {
      known.durationSeconds ??= item.lengthSeconds;
      if (!known.isShort && (!ceiling || known.publishedAt < ceiling)) ceiling = known.publishedAt;
      continue;
    }
    const exactAt = exact.get(item.videoId);
    if (!exactAt && !item.publishedAt) continue;
    let at = exactAt ?? (item.publishedAt as string);
    if (!exactAt && ceiling && at >= ceiling) at = new Date(Date.parse(ceiling) - 60_000).toISOString();
    if (!ceiling || at < ceiling) ceiling = at;
    out.push({
      videoId: item.videoId,
      title: item.title,
      publishedAt: at,
      approxDate: !exactAt,
      views: item.views,
      isShort: false,
      channelName,
      durationSeconds: item.lengthSeconds,
    });
  }
  return out;
}

export async function addLibraryChannel(
  input: string,
  opts: { backfill?: boolean; deep?: boolean; signal?: AbortSignal } = {},
): Promise<{ channel: LibraryChannel; created: boolean; backfill: BackfillResult | null }> {
  const identity = await resolveChannel(input, opts.signal);
  const now = nowIso();
  const writer = createLibraryWriter();
  const created = writer.write((db) => {
    const existed = db.prepare("SELECT 1 FROM library_channels WHERE channel_id = ?").get(identity.channelId);
    db.prepare(
      `INSERT INTO library_channels (channel_id, handle, name, avatar, subscriber_count, added_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(channel_id) DO UPDATE SET handle = COALESCE(excluded.handle, handle), name = COALESCE(excluded.name, name),
         avatar = COALESCE(excluded.avatar, avatar), subscriber_count = COALESCE(excluded.subscriber_count, subscriber_count)`,
    ).run(identity.channelId, identity.handle, identity.name, identity.avatar, identity.subscriberCount, now);
    db.prepare(
      `INSERT INTO channel_poll_state (channel_id, channel_name, subs_checked_at) VALUES (?, ?, ?)
       ON CONFLICT(channel_id) DO UPDATE SET paused = 0, subs_checked_at = excluded.subs_checked_at`,
    ).run(identity.channelId, identity.name, identity.subscriberCount != null ? now : null);
    // A user-added channel is no longer a discovery pick.
    db.prepare("UPDATE discovered_channels SET status = 'user' WHERE channel_id = ?").run(identity.channelId);
    return !existed;
  });
  await writer.settle();
  const backfill = opts.backfill === false ? null : await backfillChannel(identity.channelId, { deep: opts.deep ?? true, signal: opts.signal });
  const channel = listLibraryChannels().find((c) => c.channelId === identity.channelId);
  if (!channel) throw new LibraryError(500, "The channel was added but couldn't be read back.");
  return { channel, created, backfill };
}

export function listLibraryChannels(): LibraryChannel[] {
  const db = libraryReader();
  const rows = db
    .prepare(
      `SELECT l.channel_id AS channelId, l.handle, l.name, l.avatar, l.subscriber_count AS subscriberCount, l.added_at AS addedAt,
              l.last_synced_at AS lastSyncedAt, l.last_error AS lastError,
              CASE WHEN d.status = 'added' THEN 'discovered' ELSE 'user' END AS source,
              p.last_polled_at AS lastPolledAt, p.last_upload_at AS lastUploadAt,
              (SELECT count(*) FROM videos v WHERE v.channel_id = l.channel_id) AS videos,
              (SELECT count(*) FROM videos v WHERE v.channel_id = l.channel_id AND v.outlier_score >= 2) AS outliers
       FROM library_channels l
       LEFT JOIN discovered_channels d ON d.channel_id = l.channel_id
       LEFT JOIN channel_poll_state p ON p.channel_id = l.channel_id
       ORDER BY l.added_at DESC`,
    )
    .all() as LibraryChannel[];
  return rows.map((r) => ({ ...r, videos: Number(r.videos), outliers: Number(r.outliers) }));
}

/**
 * Stop tracking a channel: drop it from library_channels and pause its polling (which also
 * covers channels that came with the export). `purge` deletes the videos the pipeline
 * inserted for it (rss: rows); export rows stay.
 */
export function removeLibraryChannel(channelId: string, opts: { purge?: boolean } = {}): { removed: boolean; paused: boolean; purged: number } {
  if (!CHANNEL_ID_RE.test(channelId)) throw new LibraryError(400, `"${channelId}" is not a channel id (UC…).`);
  const writer = createLibraryWriter();
  return writer.write((db) => {
    const removed = Number(db.prepare("DELETE FROM library_channels WHERE channel_id = ?").run(channelId).changes) > 0;
    const inLibrary = !!db.prepare("SELECT 1 FROM channels WHERE channel_id = ?").get(channelId);
    if (!removed && !inLibrary) throw new LibraryError(404, `Channel ${channelId} isn't in the library.`);
    db.prepare("INSERT INTO channel_poll_state (channel_id, paused) VALUES (?, 1) ON CONFLICT(channel_id) DO UPDATE SET paused = 1").run(channelId);
    db.prepare("UPDATE discovered_channels SET status = 'removed' WHERE channel_id = ?").run(channelId);
    let purged = 0;
    if (opts.purge) {
      const rows = db
        .prepare("SELECT rowid, id, title, channel_name FROM videos WHERE channel_id = ? AND id LIKE 'rss:%'")
        .all(channelId) as { rowid: number; id: string; title: string; channel_name: string | null }[];
      for (const r of rows) {
        db.prepare("INSERT INTO videos_fts (videos_fts, rowid, title, channel_name) VALUES ('delete', ?, ?, ?)").run(r.rowid, r.title, r.channel_name);
        db.prepare("DELETE FROM video_niches WHERE video_row_id = ?").run(r.id);
        db.prepare("DELETE FROM video_click_triggers WHERE video_row_id = ?").run(r.id);
        db.prepare("DELETE FROM videos WHERE id = ?").run(r.id);
        purged++;
      }
      db.prepare("DELETE FROM live_videos WHERE channel_id = ? AND row_id LIKE 'rss:%'").run(channelId);
      if (db.prepare("SELECT 1 FROM videos WHERE channel_id = ? LIMIT 1").get(channelId)) refreshChannelAggregate(db, channelId);
      else db.prepare("DELETE FROM channels WHERE channel_id = ?").run(channelId);
    }
    return { removed, paused: true, purged };
  });
}

/** Poll one library channel right now (no lock needed: it only writes that channel). */
export async function syncLibraryChannel(input: string, opts: { deep?: boolean; signal?: AbortSignal } = {}): Promise<BackfillResult> {
  const channelId = CHANNEL_ID_RE.test(input.trim()) ? input.trim() : (await resolveChannel(input, opts.signal)).channelId;
  return backfillChannel(channelId, { deep: opts.deep ?? false, signal: opts.signal });
}
