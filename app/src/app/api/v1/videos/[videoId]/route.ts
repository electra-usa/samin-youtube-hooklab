import { v1Error, v1Json, v1Options } from "@/lib/api-v1/http";
import { getVideo } from "@/lib/core/query";
import { v1Route } from "../../_lib/route";

// GET /api/v1/videos/{videoId} — one video by YouTube video id, (URL-encoded) watch URL, or row id.
export const GET = v1Route<{ params: Promise<{ videoId: string }> }>(async (_req, ctx) => {
  const { videoId } = await ctx.params;
  const ref = decodeURIComponent(videoId);
  const video = getVideo(ref);
  return video ? v1Json({ data: video }) : v1Error(404, "not_found", `No video "${ref}" in the library.`);
});

export const OPTIONS = v1Options;
