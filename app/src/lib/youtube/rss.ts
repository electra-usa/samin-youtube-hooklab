import "server-only";

// Keyless YouTube RSS feeds. A channel's uploads playlist has typed variants that
// RSS also serves: UULF (long-form), UUSH (Shorts), UULV (live streams). Each feed
// lists the latest 15 uploads with exact view counts (media:statistics).

export type FeedKind = "longform" | "shorts" | "live";

export type RssEntry = {
  videoId: string;
  title: string;
  publishedAt: string;
  updatedAt: string | null;
  views: number | null;
  thumbnail: string | null;
  link: string | null;
  isShort: boolean;
};

const PLAYLIST_PREFIX: Record<FeedKind, string> = { longform: "UULF", shorts: "UUSH", live: "UULV" };

/** Typed uploads playlist id for a UC… channel id (null for anything else). */
export function typedUploadsPlaylist(channelId: string, kind: FeedKind): string | null {
  if (!/^UC[\w-]{22}$/.test(channelId)) return null;
  return PLAYLIST_PREFIX[kind] + channelId.slice(2);
}

function decodeXml(s: string): string {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h: string) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(Number(d)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

function tag(block: string, name: string): string | null {
  const m = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`).exec(block);
  return m ? decodeXml(m[1].trim()) : null;
}

function attr(block: string, name: string, attribute: string): string | null {
  const m = new RegExp(`<${name}\\b[^>]*\\s${attribute}="([^"]*)"`).exec(block);
  return m ? decodeXml(m[1]) : null;
}

export function parseFeed(xml: string): RssEntry[] {
  const entries: RssEntry[] = [];
  for (const m of xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)) {
    const block = m[1];
    const videoId = tag(block, "yt:videoId");
    const title = tag(block, "title");
    const publishedAt = tag(block, "published");
    if (!videoId || !title || !publishedAt) continue;
    const views = attr(block, "media:statistics", "views");
    const link = attr(block, "link", "href");
    entries.push({
      videoId,
      title,
      publishedAt: new Date(publishedAt).toISOString(),
      updatedAt: tag(block, "updated"),
      views: views != null && /^\d+$/.test(views) ? Number(views) : null,
      thumbnail: attr(block, "media:thumbnail", "url"),
      link,
      isShort: !!link?.includes("/shorts/"),
    });
  }
  return entries;
}

async function getFeed(query: string, timeoutMs: number): Promise<RssEntry[] | null> {
  try {
    const res = await fetch(`https://www.youtube.com/feeds/videos.xml?${query}`, {
      cache: "no-store",
      signal: AbortSignal.timeout(timeoutMs),
      headers: { "Accept-Language": "en-US,en;q=0.9" },
    });
    if (res.status === 404) return [];
    if (!res.ok) return null;
    return parseFeed(await res.text());
  } catch {
    return null;
  }
}

/** Latest uploads of one kind (null when the feed could not be fetched). */
export function fetchTypedFeed(channelId: string, kind: FeedKind, timeoutMs = 10_000) {
  const playlist = typedUploadsPlaylist(channelId, kind);
  if (!playlist) return Promise.resolve(null);
  return getFeed(`playlist_id=${playlist}`, timeoutMs);
}

/** Latest 15 uploads of any kind. */
export function fetchChannelFeed(channelId: string, timeoutMs = 10_000) {
  return getFeed(`channel_id=${encodeURIComponent(channelId)}`, timeoutMs);
}
