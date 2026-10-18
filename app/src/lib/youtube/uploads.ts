import "server-only";
import { fetchTypedFeed, type FeedKind, type RssEntry } from "./rss";
import { fetchChannelTab, ytdlpAvailable, type ChannelMeta, type ChannelTab, type FlatEntry } from "./ytdlp";

// Collects a channel's uploads from keyless sources and merges them per video.
// Exact values (RSS) win over listing values (yt-dlp flat), which are lower bounds.

export type UploadKind = FeedKind;

export type UploadRecord = {
  videoId: string;
  kind: UploadKind;
  /** Title from an exact source (RSS / per-video page). */
  title: string | null;
  /** Title from a tab listing; can be a title-test variant. */
  listTitle: string | null;
  /** Exact view count. */
  views: number | null;
  /** The exact count is older than the listing's (RSS caches counts). */
  viewsStale?: boolean;
  /** Truncated display count from a listing ("1.3K" -> 1300): a lower bound. */
  viewsFloor: number | null;
  publishedAt: string | null;
  approxPublishedAt: string | null;
  durationSeconds: number | null;
  likes: number | null;
  comments: number | null;
  thumbnail: string | null;
  /** Position within its kind, newest first. */
  order: number;
  sources: string[];
};

export type ChannelUploads = {
  channel: Partial<ChannelMeta> & { videoCount?: number | null };
  uploads: UploadRecord[];
  sources: string[];
  notes: string[];
  /** True when a listing failed and only part of the channel was seen. */
  partial: boolean;
};

const TAB_FOR_KIND: Record<UploadKind, ChannelTab> = { longform: "videos", shorts: "shorts", live: "streams" };

function blank(videoId: string, kind: UploadKind, order: number): UploadRecord {
  return {
    videoId,
    kind,
    title: null,
    listTitle: null,
    views: null,
    viewsFloor: null,
    publishedAt: null,
    approxPublishedAt: null,
    durationSeconds: null,
    likes: null,
    comments: null,
    thumbnail: null,
    order,
    sources: [],
  };
}

export async function collectKeyless(channelId: string, { limitPerKind = 200 } = {}): Promise<ChannelUploads> {
  const kinds: UploadKind[] = ["longform", "shorts", "live"];
  const useYtdlp = ytdlpAvailable();
  const notes: string[] = [];
  if (!useYtdlp) notes.push("yt-dlp not found; only the latest uploads from RSS were refreshed.");

  const [feeds, tabs] = await Promise.all([
    Promise.all(kinds.map((k) => fetchTypedFeed(channelId, k))),
    useYtdlp
      ? Promise.all(kinds.map((k) => fetchChannelTab(channelId, TAB_FOR_KIND[k], { limit: limitPerKind })))
      : Promise.resolve(kinds.map(() => null)),
  ]);

  const byId = new Map<string, UploadRecord>();
  const sources = new Set<string>();
  let partial = !useYtdlp;
  let channel: ChannelUploads["channel"] = {};

  kinds.forEach((kind, k) => {
    const tab = tabs[k] as { channel: ChannelMeta; entries: FlatEntry[] } | null;
    if (tab) {
      sources.add(`yt-dlp:${TAB_FOR_KIND[kind]}`);
      if (!channel.name && tab.channel.name) channel = { ...tab.channel };
      for (const e of tab.entries) {
        const rec = byId.get(e.videoId) ?? blank(e.videoId, kind, e.order);
        rec.kind = kind;
        rec.order = e.order;
        rec.listTitle = e.title || rec.listTitle;
        rec.viewsFloor = e.views ?? rec.viewsFloor;
        rec.durationSeconds = e.durationSeconds ?? rec.durationSeconds;
        rec.approxPublishedAt = e.approxPublishedAt ?? rec.approxPublishedAt;
        rec.sources.push("ytdlp");
        byId.set(e.videoId, rec);
      }
    } else if (useYtdlp && kind !== "live") {
      // Channels without a Live tab legitimately fail here; the other tabs should not.
      partial = true;
      notes.push(`Couldn't list the ${TAB_FOR_KIND[kind]} tab.`);
    }

    const feed = feeds[k] as RssEntry[] | null;
    if (feed) {
      sources.add(`rss:${kind}`);
      feed.forEach((e, i) => {
        const rec = byId.get(e.videoId) ?? blank(e.videoId, kind, i);
        rec.kind = kind;
        rec.title = e.title;
        rec.views = e.views;
        // RSS counts are cached; a larger listing count means the RSS one is behind.
        rec.viewsStale = rec.viewsFloor != null && rec.views != null && rec.viewsFloor > rec.views;
        rec.publishedAt = e.publishedAt;
        rec.thumbnail = e.thumbnail;
        rec.sources.push("rss");
        byId.set(e.videoId, rec);
      });
    } else {
      partial = true;
      notes.push(`Couldn't read the ${kind} RSS feed.`);
    }
  });

  // Order within kind, newest first: uploads only RSS has seen (brand new, or a
  // kind without a tab such as scheduled streams) by date, then the tab listing.
  const uploads = [...byId.values()];
  for (const kind of kinds) {
    const ofKind = uploads.filter((u) => u.kind === kind);
    const rssOnly = ofKind
      .filter((u) => !u.sources.includes("ytdlp"))
      .sort((a, b) => (b.publishedAt ?? "").localeCompare(a.publishedAt ?? ""));
    const listed = ofKind.filter((u) => u.sources.includes("ytdlp")).sort((a, b) => a.order - b.order);
    const ordered = [...rssOnly, ...listed];
    ordered.slice(limitPerKind).forEach((u) => byId.delete(u.videoId));
    ordered.slice(0, limitPerKind).forEach((u, i) => (u.order = i));
  }

  return { channel, uploads: [...byId.values()], sources: [...sources], notes, partial };
}
