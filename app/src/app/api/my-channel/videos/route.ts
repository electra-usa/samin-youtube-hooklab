import type { NextRequest } from "next/server";
import { z } from "zod";
import { noChannelResponse, resolveUserChannel } from "@/lib/channel/context";
import { listChannelVideos } from "@/lib/channel/videos";

const Query = z.object({
  limit: z.coerce.number().int().min(1).max(100).catch(24),
  cursor: z.string().optional(),
  sort: z.enum(["latest", "oldest", "popular", "unpopular", "outlier"]).catch("latest"),
  timeFilter: z.enum(["all", "7", "30", "365"]).catch("all"),
  type: z.enum(["longform", "shorts", "livestreams"]).catch("longform"),
  search: z.string().optional(),
  searchMode: z.string().optional(),
  minScore: z.coerce.number().optional().catch(undefined),
  maxScore: z.coerce.number().optional().catch(undefined),
  userChannelId: z.string().optional(),
});

// Your own channel's videos, paged by cursor (original: GET /api/my-channel/videos).
export async function GET(req: NextRequest) {
  const q = Query.parse(Object.fromEntries(req.nextUrl.searchParams));
  const channel = resolveUserChannel(q.userChannelId);
  if (!channel) return noChannelResponse();
  const data = listChannelVideos({
    userChannelId: channel.id,
    tab: q.type,
    sort: q.sort,
    timeFilter: q.timeFilter,
    search: q.search,
    searchMode: q.searchMode,
    limit: q.limit,
    cursor: q.cursor,
    minScore: q.minScore,
    maxScore: q.maxScore,
  });
  return Response.json({ success: true, data });
}
