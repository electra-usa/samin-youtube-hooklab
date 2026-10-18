// Keyless YouTube RSS. Every channel has typed uploads playlists that RSS also serves:
// UULF<id> = long-form uploads (no Shorts, no live streams), UUSH<id> = Shorts. Each feed
// lists the latest 15 entries with exact view counts (media:statistics). YouTube caches
// feeds for 15 minutes (Cache-Control: max-age=900) and sends no ETag/Last-Modified, so
// conditional requests aren't possible; polling a channel more often than that is wasted.
import { politeGet } from "./http.ts";
import { CHANNEL_ID_RE, decodeXml } from "./util.ts";

export type FeedKind = "long" | "short" | "all";

export type FeedEntry = {
  videoId: string;
  title: string;
  publishedAt: string;
  views: number | null;
  isShort: boolean;
  channelName: string | null;
};

export type FeedResult =
  | { ok: true; status: number; channelName: string | null; entries: FeedEntry[] }
  | { ok: false; status: number; missing: boolean; error: string };

const rawTag = (block: string, name: string) => new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`).exec(block)?.[1] ?? null;
const tag = (block: string, name: string) => {
  const inner = rawTag(block, name);
  return inner == null ? null : decodeXml(inner.trim());
};
const attr = (block: string, name: string, attribute: string) => {
  const m = new RegExp(`<${name}\\b[^>]*\\s${attribute}="([^"]*)"`).exec(block);
  return m ? decodeXml(m[1]) : null;
};

export function parseFeed(xml: string, kind: FeedKind): { channelName: string | null; entries: FeedEntry[] } {
  const head = xml.split("<entry>")[0];
  const feedAuthor = tag(rawTag(head, "author") ?? "", "name");
  const entries: FeedEntry[] = [];
  const now = Date.now();
  for (const m of xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)) {
    const block = m[1];
    const videoId = tag(block, "yt:videoId");
    const title = tag(block, "title");
    const published = tag(block, "published");
    const publishedMs = published ? Date.parse(published) : Number.NaN;
    if (!videoId || !title || !Number.isFinite(publishedMs)) continue;
    // Scheduled premieres/streams can carry a future time; they show up again once live.
    if (publishedMs > now + 10 * 60_000) continue;
    const views = attr(block, "media:statistics", "views");
    const link = attr(block, "link", "href") ?? "";
    entries.push({
      videoId,
      title,
      publishedAt: new Date(publishedMs).toISOString(),
      views: views != null && /^\d+$/.test(views) ? Number(views) : null,
      isShort: kind === "short" ? true : kind === "long" ? false : link.includes("/shorts/"),
      channelName: tag(rawTag(block, "author") ?? "", "name") ?? feedAuthor,
    });
  }
  return { channelName: feedAuthor ?? tag(head, "title"), entries };
}

export function feedUrl(channelId: string, kind: FeedKind): string {
  if (kind === "all") return `https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`;
  return `https://www.youtube.com/feeds/videos.xml?playlist_id=${kind === "long" ? "UULF" : "UUSH"}${channelId.slice(2)}`;
}

/** One uploads feed. `missing` means YouTube answered 404 (no such channel, or no uploads of that kind). */
export async function fetchFeed(channelId: string, kind: FeedKind, signal?: AbortSignal): Promise<FeedResult> {
  if (!CHANNEL_ID_RE.test(channelId)) return { ok: false, status: 0, missing: true, error: "not a UC… channel id" };
  const res = await politeGet(feedUrl(channelId, kind), { signal });
  if (res.status === 404) return { ok: false, status: 404, missing: true, error: "feed not found" };
  if (res.text == null) return { ok: false, status: res.status, missing: false, error: res.error ?? `HTTP ${res.status}` };
  if (!res.text.includes("<feed")) return { ok: false, status: res.status, missing: false, error: "not a feed" };
  const parsed = parseFeed(res.text, kind);
  return { ok: true, status: res.status, ...parsed };
}
