import { v1Error, v1Json, v1Options } from "@/lib/api-v1/http";
import { getChannel } from "@/lib/core/query";
import { paramsInput, v1Route } from "../../_lib/route";

// GET /api/v1/channels/{channelId} — a channel by UC… id, @handle, (URL-encoded) channel URL or
// name, with its tier/niche/trigger breakdown and top videos by outlier score (?videos=n, default 10).
export const GET = v1Route<{ params: Promise<{ channelId: string }> }>(async (req, ctx) => {
  const { channelId } = await ctx.params;
  const ref = decodeURIComponent(channelId);
  const { videos } = paramsInput(new URL(req.url).searchParams, ["videos"]);
  const detail = getChannel(ref, { videos });
  return detail ? v1Json({ data: detail }) : v1Error(404, "not_found", `No channel "${ref}" in the library.`);
});

export const OPTIONS = v1Options;
