import { NextResponse } from "next/server";
import { library } from "@/lib/db/library";
import { compactViews, outlierLabel } from "@/lib/chat/format";

// Hover cards for channels cited in replies (cref:<channelId>), from the outlier library.
// GET ?ids=a,b → { data: [{ channelId, channelName, subscriberCount, videoCount, recentVideos: VideoRef[] }] }
export async function GET(req: Request) {
  const ids = (new URL(req.url).searchParams.get("ids") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 20);
  if (!ids.length) return NextResponse.json({ data: [] });
  const db = library();
  const channels = db
    .prepare(`SELECT channel_id, channel_name, subscriber_count, video_count FROM channels WHERE channel_id IN (${ids.map(() => "?").join(",")})`)
    .all(...ids) as { channel_id: string; channel_name: string | null; subscriber_count: number | null; video_count: number }[];
  const recent = db.prepare(
    "SELECT video_id, title, views, outlier_score, publish_at, channel_name FROM videos WHERE channel_id = ? ORDER BY publish_at DESC LIMIT 3",
  );
  const data = channels.map((c) => ({
    channelId: c.channel_id,
    channelName: c.channel_name ?? "Unknown channel",
    subscriberCount: c.subscriber_count,
    videoCount: c.video_count,
    recentVideos: (recent.all(c.channel_id) as { video_id: string; title: string; views: number; outlier_score: number; publish_at: string | null; channel_name: string | null }[]).map(
      (v) => ({
        title: v.title,
        views: compactViews(v.views),
        outlierScore: outlierLabel(v.outlier_score),
        channelName: v.channel_name ?? "",
        videoId: v.video_id,
        publishedAt: v.publish_at,
      }),
    ),
  }));
  return NextResponse.json({ data });
}
