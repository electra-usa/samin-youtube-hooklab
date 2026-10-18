import "server-only";
import fs from "node:fs";
import { execFile } from "node:child_process";

// yt-dlp as a keyless YouTube source. Flat tab listings are fast and complete but
// their view counts are YouTube's truncated display values ("30K views" -> 30000)
// and they carry no exact publish time; per-video extraction is exact but costs
// ~1.5 s per video, so callers use it sparingly.

const YTDLP = process.env.YTDLP_PATH ?? "/opt/homebrew/bin/yt-dlp";

export type ChannelTab = "videos" | "shorts" | "streams";

export type ChannelMeta = {
  channelId: string;
  name: string | null;
  handle: string | null;
  avatar: string | null;
  subscriberCount: number | null;
};

export type FlatEntry = {
  videoId: string;
  title: string;
  /** Truncated display count (exact below 1,000). */
  views: number | null;
  durationSeconds: number | null;
  /** Day-level estimate from "3 weeks ago" (videos tab only). */
  approxPublishedAt: string | null;
  liveStatus: string | null;
  /** Position in the tab, 0 = newest. */
  order: number;
};

export type VideoDetails = {
  videoId: string;
  title: string;
  views: number | null;
  likes: number | null;
  comments: number | null;
  durationSeconds: number | null;
  publishedAt: string | null;
  liveStatus: string | null;
  channelId: string | null;
};

export function ytdlpAvailable(): boolean {
  try {
    fs.accessSync(YTDLP, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function run(args: string[], timeoutMs: number): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolve) => {
    execFile(YTDLP, args, { timeout: timeoutMs, maxBuffer: 64 * 1024 * 1024 }, (error, stdout, stderr) => {
      const code = error ? (typeof error.code === "number" ? error.code : 1) : 0;
      resolve({ stdout: stdout?.toString() ?? "", stderr: stderr?.toString() ?? "", code });
    });
  });
}

type RawThumb = { id?: string; url?: string; width?: number; height?: number };

function pickAvatar(thumbs: RawThumb[] | undefined): string | null {
  if (!thumbs?.length) return null;
  const square = thumbs.filter((t) => t.url && t.width && t.width === t.height).sort((a, b) => (b.width ?? 0) - (a.width ?? 0))[0];
  return square?.url ?? thumbs.find((t) => t.id === "avatar_uncropped")?.url ?? null;
}

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** Flat listing of a channel tab, newest first. Null when the tab is missing or yt-dlp failed. */
export async function fetchChannelTab(
  channelId: string,
  tab: ChannelTab,
  { limit = 200, timeoutMs = 90_000 }: { limit?: number; timeoutMs?: number } = {},
): Promise<{ channel: ChannelMeta; entries: FlatEntry[] } | null> {
  const url = `https://www.youtube.com/channel/${channelId}/${tab}`;
  const args = [
    "--flat-playlist",
    "--dump-single-json",
    "--no-warnings",
    "--playlist-end",
    String(limit),
    "--extractor-args",
    "youtubetab:approximate_date",
    url,
  ];
  const { stdout, code } = await run(args, timeoutMs);
  if (code !== 0 || !stdout.trim()) return null;
  let data: Record<string, unknown>;
  try {
    data = JSON.parse(stdout);
  } catch {
    return null;
  }
  const rawEntries = (Array.isArray(data.entries) ? data.entries : []) as Record<string, unknown>[];
  const entries: FlatEntry[] = [];
  rawEntries.forEach((e, i) => {
    const id = typeof e.id === "string" ? e.id : null;
    if (!id || !/^[\w-]{11}$/.test(id)) return;
    const ts = num(e.timestamp);
    entries.push({
      videoId: id,
      title: typeof e.title === "string" ? e.title : "",
      views: num(e.view_count),
      durationSeconds: num(e.duration),
      approxPublishedAt: ts ? new Date(ts * 1000).toISOString() : null,
      liveStatus: typeof e.live_status === "string" ? e.live_status : null,
      order: i,
    });
  });
  return {
    channel: {
      channelId: (typeof data.channel_id === "string" && data.channel_id) || channelId,
      name: typeof data.channel === "string" ? data.channel : null,
      handle: typeof data.uploader_id === "string" ? data.uploader_id : null,
      avatar: pickAvatar(data.thumbnails as RawThumb[] | undefined),
      subscriberCount: num(data.channel_follower_count),
    },
    entries,
  };
}

function toDetails(d: Record<string, unknown>): VideoDetails | null {
  const id = typeof d.id === "string" ? d.id : null;
  if (!id) return null;
  const ts = num(d.timestamp) ?? num(d.release_timestamp);
  let publishedAt = ts ? new Date(ts * 1000).toISOString() : null;
  if (!publishedAt && typeof d.upload_date === "string" && /^\d{8}$/.test(d.upload_date)) {
    const u = d.upload_date;
    publishedAt = new Date(`${u.slice(0, 4)}-${u.slice(4, 6)}-${u.slice(6, 8)}T00:00:00Z`).toISOString();
  }
  return {
    videoId: id,
    title: typeof d.title === "string" ? d.title : "",
    views: num(d.view_count),
    likes: num(d.like_count),
    comments: num(d.comment_count),
    durationSeconds: num(d.duration),
    publishedAt,
    liveStatus: typeof d.live_status === "string" ? d.live_status : null,
    channelId: typeof d.channel_id === "string" ? d.channel_id : null,
  };
}

/** Exact metadata for specific videos (one yt-dlp process per chunk, a few in parallel). */
export async function fetchVideoDetails(
  videoIds: string[],
  {
    concurrency = 4,
    chunkSize = 8,
    timeoutMs = 120_000,
    onProgress,
  }: { concurrency?: number; chunkSize?: number; timeoutMs?: number; onProgress?: (done: number, total: number) => void } = {},
): Promise<Map<string, VideoDetails>> {
  const out = new Map<string, VideoDetails>();
  const chunks: string[][] = [];
  for (let i = 0; i < videoIds.length; i += chunkSize) chunks.push(videoIds.slice(i, i + chunkSize));
  let next = 0;
  let done = 0;
  const worker = async () => {
    while (next < chunks.length) {
      const chunk = chunks[next++];
      const args = [
        "-j",
        "--skip-download",
        "--no-warnings",
        "--no-playlist",
        "--ignore-errors",
        ...chunk.map((id) => `https://www.youtube.com/watch?v=${id}`),
      ];
      const { stdout } = await run(args, timeoutMs);
      for (const line of stdout.split("\n")) {
        if (!line.trim().startsWith("{")) continue;
        try {
          const details = toDetails(JSON.parse(line));
          if (details) out.set(details.videoId, details);
        } catch {
          // a truncated line from a timed-out process
        }
      }
      done += chunk.length;
      onProgress?.(done, videoIds.length);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, chunks.length) }, worker));
  return out;
}
