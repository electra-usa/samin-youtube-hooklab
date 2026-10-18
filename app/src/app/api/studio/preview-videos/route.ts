import { activeChannel } from "@/lib/db/app";
import { resolveAvatars } from "@/lib/youtube/avatars";
import { nicheVideos, primaryNiches, randomVideos, type PreviewMode } from "../_lib/preview";

// GET /api/studio/preview-videos?limit=&mode=niche|random (broad = random)
// -> { success, videos: [{ id, videoId, title, thumbnail, views, publishAt, duration, Channel }], meta }
export async function GET(req: Request) {
  const params = new URL(req.url).searchParams;
  const limit = Math.min(Math.max(Number(params.get("limit")) || 12, 1), 60);
  const requestedMode: PreviewMode = params.get("mode") === "random" || params.get("mode") === "broad" ? "random" : "niche";

  const channel = activeChannel();
  const niches = primaryNiches(channel?.id ?? null);
  const supportsNiche = niches.length > 0;
  let appliedMode: PreviewMode = requestedMode;
  let fallbackReason: string | null = null;

  let rows = requestedMode === "niche" && supportsNiche ? nicheVideos(niches, limit) : [];
  if (requestedMode === "niche" && rows.length < limit) {
    fallbackReason = supportsNiche
      ? "Not enough recent videos in your niche yet, so this preview uses a random mix."
      : "This channel has no niche tags yet, so this preview uses a random mix.";
    appliedMode = "random";
    rows = randomVideos(limit);
  } else if (requestedMode === "random") {
    rows = randomVideos(limit);
  }

  const avatars = await resolveAvatars(rows.map((r) => r.channel_id ?? ""));
  return Response.json({
    success: true,
    videos: rows.map((r) => ({
      id: r.id,
      videoId: r.video_id,
      title: r.title,
      thumbnail: r.thumbnail_url,
      views: r.views ?? 0,
      publishAt: r.publish_at,
      duration: r.duration,
      Channel: { channelName: r.channel_name ?? "", channelAvatar: (r.channel_id && avatars.get(r.channel_id)) || null },
    })),
    meta: { requestedMode, appliedMode, supportsNiche, fallbackReason },
  });
}
