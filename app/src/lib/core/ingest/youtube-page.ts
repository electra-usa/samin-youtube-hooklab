// Keyless YouTube pages: channel identity from the public channel page, a video's channel
// through oEmbed, and a video's duration from its watch page. Best effort and time-limited;
// used sparingly (library add, discovery fallbacks, duration fallback when credits are out).
import { politeGet } from "./http.ts";
import { CHANNEL_ID_RE, decodeXml, parseCount } from "./util.ts";

export type ChannelIdentity = {
  channelId: string;
  name: string | null;
  handle: string | null;
  avatar: string | null;
  subscriberCount: number | null;
};

/** What a user typed: a UC id, an @handle, or a YouTube URL (channel, @handle, /c/, /user/, video). */
export type ChannelRef =
  | { kind: "id"; channelId: string }
  | { kind: "handle"; handle: string }
  | { kind: "path"; path: string }
  | { kind: "video"; videoId: string };

export function parseChannelRef(input: string): ChannelRef | null {
  const raw = input.trim();
  if (!raw) return null;
  if (CHANNEL_ID_RE.test(raw)) return { kind: "id", channelId: raw };
  if (/^@[\p{L}\p{N}._·-]{2,}$/u.test(raw)) return { kind: "handle", handle: raw };
  let url: URL | null = null;
  try {
    url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
  } catch {
    url = null;
  }
  const host = url?.hostname.replace(/^(www|m|music)\./, "") ?? "";
  if (url && (host === "youtube.com" || host === "youtu.be")) {
    const parts = url.pathname.split("/").filter(Boolean).map((p) => decodeURIComponent(p));
    const videoId =
      host === "youtu.be" ? parts[0] : (url.searchParams.get("v") ?? (["shorts", "live", "embed"].includes(parts[0]) ? parts[1] : null));
    if (videoId && /^[\w-]{11}$/.test(videoId)) return { kind: "video", videoId };
    if (parts[0] === "channel" && parts[1] && CHANNEL_ID_RE.test(parts[1])) return { kind: "id", channelId: parts[1] };
    if (parts[0]?.startsWith("@")) return { kind: "handle", handle: parts[0] };
    if ((parts[0] === "c" || parts[0] === "user") && parts[1]) return { kind: "path", path: `${parts[0]}/${parts[1]}` };
    if (parts.length === 1) return { kind: "path", path: parts[0] };
    return null;
  }
  // A bare word is most likely a handle without the @.
  if (/^[\w.-]{3,30}$/.test(raw)) return { kind: "handle", handle: `@${raw}` };
  return null;
}

function parseChannelPage(html: string): ChannelIdentity | null {
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
    name: name ? decodeXml(name) : null,
    handle: handle ? decodeURIComponent(handle) : null,
    avatar: avatar ? decodeXml(avatar) : null,
    subscriberCount: parseCount(subs),
  };
}

/** Identity from youtube.com/<path> (a UC id, "@handle", "c/name" or "user/name"); status 404 = no such channel. */
export async function fetchChannelPageResult(pathOrId: string, signal?: AbortSignal): Promise<{ status: number; identity: ChannelIdentity | null }> {
  const path = CHANNEL_ID_RE.test(pathOrId) ? `channel/${pathOrId}` : pathOrId.replace(/^\/+/, "");
  const res = await politeGet(`https://www.youtube.com/${encodeURI(path)}`, { retries: 1, signal });
  return { status: res.status, identity: res.text ? parseChannelPage(res.text) : null };
}

export async function fetchChannelPage(pathOrId: string, signal?: AbortSignal): Promise<ChannelIdentity | null> {
  return (await fetchChannelPageResult(pathOrId, signal)).identity;
}

/** The channel that uploaded a video (oEmbed's author_url), as a page path. */
export async function channelPathForVideo(videoId: string, signal?: AbortSignal): Promise<string | null> {
  const url = `https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(`https://www.youtube.com/watch?v=${videoId}`)}`;
  const res = await politeGet(url, { retries: 1, signal });
  if (!res.text) return null;
  try {
    const authorUrl = (JSON.parse(res.text) as { author_url?: string }).author_url;
    return authorUrl ? new URL(authorUrl).pathname.replace(/^\/+/, "") : null;
  } catch {
    return null;
  }
}

/** Exact length and publish time from a video's watch page (ytInitialPlayerResponse). */
export async function fetchWatchPageDetails(videoId: string, signal?: AbortSignal): Promise<{ lengthSeconds: number | null; publishedAt: string | null } | null> {
  const res = await politeGet(`https://www.youtube.com/watch?v=${videoId}`, { retries: 1, timeoutMs: 15_000, signal });
  if (!res.text) return null;
  const length = /"lengthSeconds":"(\d+)"/.exec(res.text)?.[1];
  const published = /"publishDate":"([^"]+)"/.exec(res.text)?.[1] ?? /itemprop="datePublished" content="([^"]+)"/.exec(res.text)?.[1];
  const ms = published ? Date.parse(published) : Number.NaN;
  return { lengthSeconds: length ? Number(length) : null, publishedAt: Number.isFinite(ms) ? new Date(ms).toISOString() : null };
}

export async function fetchWatchPageDuration(videoId: string, signal?: AbortSignal): Promise<number | null> {
  return (await fetchWatchPageDetails(videoId, signal))?.lengthSeconds ?? null;
}
