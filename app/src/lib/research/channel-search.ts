import "server-only";
import { appDb } from "@/lib/db/app";
import { library } from "@/lib/db/library";
import { searchYouTubeChannels, type YouTubeChannel } from "./youtube";

/**
 * Channel JSON used by resolve-channel and search-channels. Carries both naming
 * styles: `name`/`avatar` (HookLab contract, used by Settings) and the original's
 * `channelName`/`channelAvatar`.
 */
export function channelPayload(c: YouTubeChannel, source?: "library" | "youtube" | "following") {
  return {
    channelId: c.channelId,
    name: c.name,
    handle: c.handle,
    avatar: c.avatar,
    subscriberCount: c.subscriberCount,
    channelName: c.name,
    channelAvatar: c.avatar,
    channelUrl: c.handle ? `https://www.youtube.com/${c.handle}` : `https://www.youtube.com/channel/${c.channelId}`,
    ...(source ? { source } : {}),
  };
}

export type ChannelResult = ReturnType<typeof channelPayload>;

const likeEscape = (s: string) => s.replace(/[\\%_]/g, (m) => `\\${m}`);

function libraryMatches(q: string, max: number): YouTubeChannel[] {
  const rows = library()
    .prepare(
      `SELECT channel_id, channel_name, subscriber_count FROM channels
       WHERE channel_name LIKE ? ESCAPE '\\'
       ORDER BY lower(channel_name) = lower(?) DESC, channel_name LIKE ? ESCAPE '\\' DESC, subscriber_count DESC
       LIMIT ?`,
    )
    .all(`%${likeEscape(q)}%`, q, `${likeEscape(q)}%`, max) as { channel_id: string; channel_name: string; subscriber_count: number | null }[];
  return rows.map((r) => ({ channelId: r.channel_id, name: r.channel_name, handle: null, avatar: null, subscriberCount: r.subscriber_count }));
}

function knownAvatars(ids: string[]): Map<string, { avatar: string | null; handle: string | null }> {
  if (!ids.length) return new Map();
  const rows = appDb()
    .prepare("SELECT channel_id, avatar, handle FROM followed_channels WHERE channel_id IN (SELECT value FROM json_each(?))")
    .all(JSON.stringify(ids)) as { channel_id: string; avatar: string | null; handle: string | null }[];
  return new Map(rows.map((r) => [r.channel_id, { avatar: r.avatar, handle: r.handle }]));
}

const withTimeout = <T>(p: Promise<T>, ms: number, fallback: T) =>
  Promise.race([p.catch(() => fallback), new Promise<T>((resolve) => setTimeout(() => resolve(fallback), ms))]);

/** Exact and prefix library matches first, then YouTube's own ranking, then looser library matches. */
export async function searchChannels(q: string, max: number, opts: { youtube?: boolean } = {}): Promise<ChannelResult[]> {
  const lower = q.toLowerCase();
  const [lib, yt] = await Promise.all([
    Promise.resolve(libraryMatches(q, max * 2)),
    opts.youtube === false ? Promise.resolve([] as YouTubeChannel[]) : withTimeout(searchYouTubeChannels(q, max), 4000, [] as YouTubeChannel[]),
  ]);
  const ytById = new Map(yt.map((c) => [c.channelId, c]));
  const strong = lib.filter((c) => c.name.toLowerCase() === lower || c.name.toLowerCase().startsWith(lower));
  const loose = lib.filter((c) => !strong.includes(c));
  const ordered: { c: YouTubeChannel; source: "library" | "youtube" }[] = [
    ...strong.map((c) => ({ c, source: "library" as const })),
    ...yt.map((c) => ({ c, source: "youtube" as const })),
    ...loose.map((c) => ({ c, source: "library" as const })),
  ];
  const seen = new Set<string>();
  const picked: { c: YouTubeChannel; source: "library" | "youtube" }[] = [];
  for (const item of ordered) {
    if (seen.has(item.c.channelId)) continue;
    seen.add(item.c.channelId);
    // Library rows lack avatars and handles; borrow them from YouTube's result when present.
    const extra = ytById.get(item.c.channelId);
    picked.push({ ...item, c: extra ? { ...item.c, ...extra, name: item.c.name || extra.name } : item.c });
    if (picked.length >= max) break;
  }
  const known = knownAvatars(picked.filter((p) => !p.c.avatar).map((p) => p.c.channelId));
  return picked.map(({ c, source }) => {
    const k = known.get(c.channelId);
    return channelPayload({ ...c, avatar: c.avatar ?? k?.avatar ?? null, handle: c.handle ?? k?.handle ?? null }, source);
  });
}
