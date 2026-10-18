import type { NextRequest } from "next/server";
import { getChangeHistory, getChannelVideo, getViewHistory } from "@/lib/channel/videos";

// One of your videos with its daily view history (the Video Performance page's data).
export async function GET(_req: NextRequest, ctx: RouteContext<"/api/my-channel/videos/[videoId]">) {
  const { videoId } = await ctx.params;
  const video = getChannelVideo(videoId);
  if (!video) return Response.json({ success: false, error: "Video not found" }, { status: 404 });
  return Response.json({ success: true, data: { video, history: getViewHistory(videoId), changes: getChangeHistory(videoId) } });
}
