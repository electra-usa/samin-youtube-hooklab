import "server-only";
import { typedUploadsPlaylist } from "./rss";
import type { ChannelUploads, UploadKind, UploadRecord } from "./uploads";

// Optional exact source: YouTube Data API v3 (set YOUTUBE_API_KEY). The typed
// uploads playlists (UULF/UUSH/UULV) give the Shorts/long-form/live split.

const API = "https://www.googleapis.com/youtube/v3";

export const youtubeApiKey = () => process.env.YOUTUBE_API_KEY?.trim() || null;

async function api<T>(path: string, params: Record<string, string>, key: string): Promise<T> {
  const qs = new URLSearchParams({ ...params, key });
  const res = await fetch(`${API}/${path}?${qs}`, { cache: "no-store", signal: AbortSignal.timeout(15_000) });
  const body = (await res.json().catch(() => ({}))) as T & { error?: { message?: string } };
  if (!res.ok) throw new Error(body.error?.message ?? `YouTube API ${path} failed (${res.status})`);
  return body;
}

function isoDurationSeconds(iso: string | undefined): number | null {
  if (!iso) return null;
  const m = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(iso);
  if (!m) return null;
  const [, d, h, min, s] = m.map((v) => (v ? Number(v) : 0));
  return d * 86400 + h * 3600 + min * 60 + s;
}

type PlaylistPage = { items?: { contentDetails?: { videoId?: string } }[]; nextPageToken?: string };
type VideosPage = {
  items?: {
    id: string;
    snippet?: { title?: string; publishedAt?: string; liveBroadcastContent?: string; thumbnails?: Record<string, { url?: string }> };
    statistics?: { viewCount?: string; likeCount?: string; commentCount?: string };
    contentDetails?: { duration?: string };
    liveStreamingDetails?: { actualStartTime?: string; scheduledStartTime?: string };
  }[];
};
type ChannelsPage = {
  items?: {
    snippet?: { title?: string; customUrl?: string; thumbnails?: Record<string, { url?: string }> };
    statistics?: { subscriberCount?: string; videoCount?: string; hiddenSubscriberCount?: boolean };
  }[];
};

const toNum = (v: string | undefined) => (v != null && /^\d+$/.test(v) ? Number(v) : null);

export async function collectWithDataApi(channelId: string, key: string, { limitPerKind = 200 } = {}): Promise<ChannelUploads> {
  const channels = await api<ChannelsPage>("channels", { part: "snippet,statistics", id: channelId }, key);
  const ch = channels.items?.[0];
  if (!ch) throw new Error("Channel not found on YouTube");

  const kinds: UploadKind[] = ["longform", "shorts", "live"];
  const idsByKind = new Map<UploadKind, string[]>();
  for (const kind of kinds) {
    const playlistId = typedUploadsPlaylist(channelId, kind);
    const ids: string[] = [];
    let pageToken: string | undefined;
    while (playlistId && ids.length < limitPerKind) {
      let page: PlaylistPage;
      try {
        page = await api<PlaylistPage>(
          "playlistItems",
          { part: "contentDetails", playlistId, maxResults: "50", ...(pageToken ? { pageToken } : {}) },
          key,
        );
      } catch {
        break; // a channel without (say) live streams has no UULV playlist
      }
      for (const it of page.items ?? []) if (it.contentDetails?.videoId) ids.push(it.contentDetails.videoId);
      if (!page.nextPageToken) break;
      pageToken = page.nextPageToken;
    }
    idsByKind.set(kind, ids.slice(0, limitPerKind));
  }

  const uploads: UploadRecord[] = [];
  for (const kind of kinds) {
    const ids = idsByKind.get(kind) ?? [];
    for (let i = 0; i < ids.length; i += 50) {
      const page = await api<VideosPage>(
        "videos",
        { part: "snippet,statistics,contentDetails,liveStreamingDetails", id: ids.slice(i, i + 50).join(",") },
        key,
      );
      for (const v of page.items ?? []) {
        const thumbs = v.snippet?.thumbnails ?? {};
        uploads.push({
          videoId: v.id,
          kind,
          title: v.snippet?.title ?? null,
          listTitle: null,
          views: toNum(v.statistics?.viewCount),
          viewsFloor: null,
          publishedAt: v.snippet?.publishedAt ? new Date(v.snippet.publishedAt).toISOString() : null,
          approxPublishedAt: null,
          durationSeconds: isoDurationSeconds(v.contentDetails?.duration),
          likes: toNum(v.statistics?.likeCount),
          comments: toNum(v.statistics?.commentCount),
          thumbnail: thumbs.high?.url ?? thumbs.medium?.url ?? null,
          order: ids.indexOf(v.id),
          sources: ["youtube-api"],
        });
      }
    }
  }

  const thumbs = ch.snippet?.thumbnails ?? {};
  return {
    channel: {
      channelId,
      name: ch.snippet?.title ?? null,
      handle: ch.snippet?.customUrl ?? null,
      avatar: thumbs.high?.url ?? thumbs.medium?.url ?? null,
      subscriberCount: ch.statistics?.hiddenSubscriberCount ? null : toNum(ch.statistics?.subscriberCount),
      videoCount: toNum(ch.statistics?.videoCount),
    },
    uploads,
    sources: ["youtube-api"],
    notes: [],
    partial: false,
  };
}
