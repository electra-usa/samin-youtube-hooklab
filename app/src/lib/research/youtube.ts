import "server-only";

// Keyless YouTube access: the public RSS feed for recent uploads, the public channel
// page for identity (id, name, handle, avatar, subscribers), and the public search
// results page for channel search. All parsing is best-effort and time-limited.

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";
const HEADERS = { "User-Agent": UA, "Accept-Language": "en-US,en;q=0.9", Cookie: "CONSENT=YES+1; SOCS=CAI" };
const CHANNEL_ID_RE = /^UC[\w-]{22}$/;

export type YouTubeChannel = {
  channelId: string;
  name: string;
  handle: string | null;
  avatar: string | null;
  subscriberCount: number | null;
};

export type FeedVideo = {
  videoId: string;
  channelId: string;
  channelName: string | null;
  title: string;
  publishedAt: string | null;
  thumbnail: string;
  views: number | null;
  isShort: boolean;
};

async function get(url: string, timeoutMs = 8000): Promise<Response> {
  return fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(timeoutMs), cache: "no-store" });
}

export function decodeEntities(s: string): string {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h: string) => String.fromCodePoint(Number.parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(Number(d)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;|&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

/** "21.4M subscribers" -> 21400000, "1.17 million" -> 1170000, "12,345" -> 12345. */
export function parseCount(text: string | null | undefined): number | null {
  if (!text) return null;
  const m = /([\d.,]+)\s*([KMB]|thousand|million|billion)?/i.exec(text.replace(/ /g, " "));
  if (!m) return null;
  const unit = (m[2] ?? "").toLowerCase();
  const raw = unit ? m[1].replace(/,/g, "") : m[1].replace(/[.,]/g, "");
  const n = Number(raw);
  if (!Number.isFinite(n)) return null;
  const mult = unit.startsWith("k") || unit === "thousand" ? 1e3 : unit.startsWith("m") ? 1e6 : unit.startsWith("b") ? 1e9 : 1;
  return Math.round(n * mult);
}

const tag = (xml: string, name: string) => {
  const m = new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`).exec(xml);
  return m ? decodeEntities(m[1].trim()) : null;
};
const attr = (xml: string, name: string, attribute: string) => {
  const m = new RegExp(`<${name}[^>]*\\s${attribute}="([^"]*)"`).exec(xml);
  return m ? decodeEntities(m[1]) : null;
};

/** Latest uploads (about 15) from the public channel feed, Shorts flagged by their /shorts/ link. */
export async function fetchChannelFeed(channelId: string): Promise<{ channelName: string | null; videos: FeedVideo[] }> {
  if (!CHANNEL_ID_RE.test(channelId)) throw new Error("Invalid channel id");
  const res = await get(`https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`, 10_000);
  if (!res.ok) throw new Error(`Feed request failed (${res.status})`);
  const xml = await res.text();
  const head = xml.split("<entry>")[0];
  const channelName = tag(head, "title");
  const videos: FeedVideo[] = [];
  for (const m of xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)) {
    const entry = m[1];
    const videoId = tag(entry, "yt:videoId");
    const title = tag(entry, "title");
    if (!videoId || !title) continue;
    const link = attr(entry, "link", "href") ?? "";
    const views = attr(entry, "media:statistics", "views");
    const published = tag(entry, "published");
    const publishedMs = published ? Date.parse(published) : Number.NaN;
    videos.push({
      videoId,
      channelId,
      channelName: tag(entry, "name") ?? channelName,
      title,
      publishedAt: Number.isFinite(publishedMs) ? new Date(publishedMs).toISOString() : null,
      thumbnail: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
      views: views != null ? Number(views) : null,
      isShort: link.includes("/shorts/"),
    });
  }
  return { channelName, videos };
}

function parseChannelPage(html: string): YouTubeChannel | null {
  const channelId =
    /<meta itemprop="identifier" content="(UC[\w-]{22})"/.exec(html)?.[1] ??
    /"externalId":"(UC[\w-]{22})"/.exec(html)?.[1] ??
    /<link rel="canonical" href="https:\/\/www\.youtube\.com\/channel\/(UC[\w-]{22})"/.exec(html)?.[1];
  if (!channelId) return null;
  const name = /<meta property="og:title" content="([^"]*)"/.exec(html)?.[1];
  const avatar = /<meta property="og:image" content="([^"]*)"/.exec(html)?.[1] ?? null;
  const handle =
    /"vanityChannelUrl":"https?:\/\/www\.youtube\.com\/(@[^"]+)"/.exec(html)?.[1] ??
    /"canonicalBaseUrl":"\/(@[^"]+)"/.exec(html)?.[1] ??
    null;
  const subs =
    /"content":"([\d.,]+[KMB]?) subscribers?"/.exec(html)?.[1] ??
    /"subscriberCountText":\{"simpleText":"([^"]+)"/.exec(html)?.[1] ??
    null;
  return {
    channelId,
    name: decodeEntities(name ?? channelId),
    handle: handle ? decodeURIComponent(handle) : null,
    avatar: avatar ? decodeEntities(avatar) : null,
    subscriberCount: parseCount(subs),
  };
}

async function fetchChannelPage(url: string): Promise<YouTubeChannel | null> {
  const res = await get(url);
  if (!res.ok) return null;
  return parseChannelPage(await res.text());
}

const cache = new Map<string, { at: number; value: unknown }>();
async function cached<T>(key: string, ttlMs: number, fn: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < ttlMs) return hit.value as T;
  const value = await fn();
  if (value) cache.set(key, { at: Date.now(), value });
  if (cache.size > 500) cache.delete(cache.keys().next().value as string);
  return value;
}

/**
 * Resolve a channel id, @handle, channel URL (/channel, /@, /c, /user) or a video URL
 * to the channel's identity. Null when YouTube has no such channel.
 */
export function resolveChannel(input: string): Promise<YouTubeChannel | null> {
  const raw = input.trim();
  return cached(`resolve:${raw.toLowerCase()}`, 10 * 60_000, () => resolveUncached(raw));
}

async function resolveUncached(raw: string): Promise<YouTubeChannel | null> {
  if (!raw) return null;
  if (CHANNEL_ID_RE.test(raw)) return withFeedFallback(raw, await fetchChannelPage(`https://www.youtube.com/channel/${raw}`));
  if (/^@[\w.\-·]{2,}$/u.test(raw)) return fetchChannelPage(`https://www.youtube.com/${encodeURI(raw)}`);

  let url: URL | null = null;
  try {
    url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
  } catch {
    url = null;
  }
  const host = url?.hostname.replace(/^(www|m|music)\./, "") ?? "";
  if (url && (host === "youtube.com" || host === "youtu.be")) {
    const parts = url.pathname.split("/").filter(Boolean);
    const videoId =
      host === "youtu.be" ? parts[0] : url.searchParams.get("v") ?? (["shorts", "live", "embed"].includes(parts[0]) ? parts[1] : null);
    if (videoId) return resolveFromVideo(videoId);
    if (parts[0] === "channel" && parts[1] && CHANNEL_ID_RE.test(parts[1])) {
      return withFeedFallback(parts[1], await fetchChannelPage(`https://www.youtube.com/channel/${parts[1]}`));
    }
    if (parts[0]?.startsWith("@")) return fetchChannelPage(`https://www.youtube.com/${parts[0]}`);
    if ((parts[0] === "c" || parts[0] === "user") && parts[1]) return fetchChannelPage(`https://www.youtube.com/${parts[0]}/${parts[1]}`);
    if (parts.length === 1) return fetchChannelPage(`https://www.youtube.com/${parts[0]}`);
    return null;
  }
  // A bare word is most likely a handle without the @.
  if (/^[\w.\-]{3,30}$/.test(raw)) return fetchChannelPage(`https://www.youtube.com/@${raw}`);
  return null;
}

async function resolveFromVideo(videoId: string): Promise<YouTubeChannel | null> {
  const res = await get(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(`https://www.youtube.com/watch?v=${videoId}`)}`);
  if (!res.ok) return null;
  const data = (await res.json()) as { author_url?: string };
  return data.author_url ? resolveUncached(data.author_url) : null;
}

async function withFeedFallback(channelId: string, page: YouTubeChannel | null): Promise<YouTubeChannel | null> {
  if (page) return page;
  try {
    const feed = await fetchChannelFeed(channelId);
    return feed.channelName ? { channelId, name: feed.channelName, handle: null, avatar: null, subscriberCount: null } : null;
  } catch {
    return null;
  }
}

type Renderer = Record<string, unknown>;
const textOf = (node: unknown): string | null => {
  if (!node || typeof node !== "object") return null;
  const n = node as { simpleText?: string; runs?: { text: string }[] };
  return n.simpleText ?? n.runs?.map((r) => r.text).join("") ?? null;
};

/** Channels from YouTube's public search page (no API key). */
export function searchYouTubeChannels(query: string, max = 6): Promise<YouTubeChannel[]> {
  return cached(`search:${query.toLowerCase()}:${max}`, 10 * 60_000, async () => {
    const res = await get(`https://www.youtube.com/results?search_query=${encodeURIComponent(query)}&sp=EgIQAg%253D%253D`, 6000);
    if (!res.ok) return [];
    const html = await res.text();
    const json = /var ytInitialData = (\{[\s\S]*?\});<\/script>/.exec(html)?.[1];
    if (!json) return [];
    const found: YouTubeChannel[] = [];
    const walk = (node: unknown) => {
      if (found.length >= max || !node || typeof node !== "object") return;
      if (Array.isArray(node)) return node.forEach(walk);
      const obj = node as Renderer;
      const r = obj.channelRenderer as Renderer | undefined;
      if (r && typeof r.channelId === "string") {
        // YouTube shows the handle in subscriberCountText and the count in videoCountText.
        const texts = [textOf(r.subscriberCountText), textOf(r.videoCountText)].filter(Boolean) as string[];
        const thumbs = (r.thumbnail as { thumbnails?: { url: string }[] } | undefined)?.thumbnails ?? [];
        const avatar = thumbs.at(-1)?.url ?? null;
        found.push({
          channelId: r.channelId,
          name: textOf(r.title) ?? r.channelId,
          handle: texts.find((t) => t.startsWith("@")) ?? null,
          avatar: avatar ? (avatar.startsWith("//") ? `https:${avatar}` : avatar) : null,
          subscriberCount: parseCount(texts.find((t) => /subscriber/i.test(t))),
        });
        return;
      }
      for (const value of Object.values(obj)) walk(value);
    };
    walk(JSON.parse(json));
    return found;
  });
}
