import "server-only";
import { appDb } from "@/lib/db/app";
import { library, toOutlierVideo, type LibraryVideoRow, type OutlierVideo } from "@/lib/db/library";

/** Library columns without the heavy `raw` JSON. */
export const VIDEO_COLUMNS = [
  "id", "video_id", "title", "title_length", "video_url", "thumbnail_url", "channel_id", "channel_name",
  "subscriber_count", "views", "outlier_score", "tier", "publish_at", "duration", "duration_seconds", "is_short",
  "frame", "secondary_frame", "pov", "featured_in_newsletter", "niches", "click_triggers", "video_types",
]
  .map((c) => `v.${c}`)
  .join(", ");

/** A library row by Creator Hooks row id or YouTube video id. */
export function findLibraryVideo(idOrVideoId: string): OutlierVideo | null {
  const row = library()
    .prepare(`SELECT ${VIDEO_COLUMNS} FROM videos v WHERE v.id = ? OR v.video_id = ? LIMIT 1`)
    .get(idOrVideoId, idOrVideoId) as LibraryVideoRow | undefined;
  return row ? toOutlierVideo(row) : null;
}

export function libraryVideosByVideoId(videoIds: string[]): Map<string, OutlierVideo> {
  const out = new Map<string, OutlierVideo>();
  if (!videoIds.length) return out;
  const rows = library()
    .prepare(`SELECT ${VIDEO_COLUMNS} FROM videos v WHERE v.video_id IN (SELECT value FROM json_each(?))`)
    .all(JSON.stringify(videoIds)) as LibraryVideoRow[];
  for (const r of rows) out.set(r.video_id, toOutlierVideo(r));
  return out;
}

/**
 * Best-known title/details for any video the user has seen: the library first, then
 * Following's synced videos, bookmarks, and the user's own channel videos.
 */
export function findAnyVideo(idOrVideoId: string): (Partial<OutlierVideo> & { videoId: string; title: string; id: string }) | null {
  const lib = findLibraryVideo(idOrVideoId);
  if (lib) return lib;
  const db = appDb();
  const followed = db
    .prepare("SELECT video_id, channel_id, channel_name, title, thumbnail, views, published_at, outlier_score FROM followed_videos WHERE video_id = ?")
    .get(idOrVideoId) as
    | { video_id: string; channel_id: string; channel_name: string | null; title: string; thumbnail: string | null; views: number | null; published_at: string | null; outlier_score: number | null }
    | undefined;
  if (followed) {
    return {
      id: followed.video_id,
      videoId: followed.video_id,
      title: followed.title,
      channelId: followed.channel_id,
      channelName: followed.channel_name,
      thumbnail: followed.thumbnail ?? undefined,
      views: followed.views,
      publishAt: followed.published_at,
      outlierScore: followed.outlier_score,
    };
  }
  const bookmark = db.prepare("SELECT video_json FROM bookmarks WHERE video_id = ?").get(idOrVideoId) as { video_json: string } | undefined;
  if (bookmark) {
    try {
      const v = JSON.parse(bookmark.video_json) as Partial<OutlierVideo>;
      if (v.title) return { ...v, id: v.id ?? idOrVideoId, videoId: idOrVideoId, title: v.title };
    } catch {
      // fall through
    }
  }
  const own = db.prepare("SELECT video_id, title, channel_id FROM channel_videos WHERE video_id = ?").get(idOrVideoId) as
    | { video_id: string; title: string; channel_id: string }
    | undefined;
  return own ? { id: own.video_id, videoId: own.video_id, title: own.title, channelId: own.channel_id } : null;
}
