// Fetches one channel's uploads: the long-form feed (UULF) every time, the Shorts feed (UUSH)
// when the channel posts Shorts (re-checked weekly otherwise). When neither typed feed exists,
// the plain channel feed tells a channel without long-form uploads from a deleted one.
import type { ChannelPoll, PolledVideo } from "./apply.ts";
import { shortsDue, type Candidate } from "./channels.ts";
import { fetchFeed } from "./rss.ts";

export async function pollChannel(
  c: Pick<Candidate, "channelId" | "hasShorts" | "shortsCheckedAt">,
  opts: { shorts: boolean; signal?: AbortSignal },
): Promise<ChannelPoll> {
  let requests = 1;
  const long = await fetchFeed(c.channelId, "long", opts.signal);
  const short = opts.shorts && shortsDue(c) ? (requests++, await fetchFeed(c.channelId, "short", opts.signal)) : null;

  const videos: PolledVideo[] = [];
  let channelName: string | null = null;
  let error: string | null = null;
  let missing = false;
  let hasShorts: 0 | 1 | null = null;
  if (long.ok) {
    videos.push(...long.entries);
    channelName = long.channelName;
  }
  if (short) {
    if (short.ok) {
      videos.push(...short.entries);
      channelName ??= short.channelName;
      hasShorts = short.entries.length ? 1 : 0;
    } else if (short.missing) {
      hasShorts = 0;
    }
  }
  if (!long.ok) {
    if (!long.missing) {
      error = `long-form feed: ${long.error}`;
    } else if (!short?.ok) {
      const all = await fetchFeed(c.channelId, "all", opts.signal);
      requests++;
      if (all.ok) {
        channelName = all.channelName;
        // Without a long-form playlist, the channel feed's non-Short entries are live streams.
        if (opts.shorts) {
          const shorts = all.entries.filter((e) => e.isShort);
          videos.push(...shorts);
          hasShorts = shorts.length ? 1 : (hasShorts ?? 0);
        }
      } else if (all.missing) {
        missing = true;
        error = "no RSS feed for this channel (deleted or terminated?)";
      } else {
        error = `channel feed: ${all.error}`;
      }
    }
  }
  return { channelId: c.channelId, channelName, videos, hasShorts, error, missing, requests };
}
