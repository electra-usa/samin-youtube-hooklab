import { v1Json, v1Options } from "@/lib/api-v1/http";
import { CHANNEL_QUERY_PARAMS, listChannels } from "@/lib/core/query";
import { paramsInput, v1Route } from "../_lib/route";

// GET /api/v1/channels — channels in the library: ?q= name/handle search, sort, tracked, limit, cursor.
export const GET = v1Route((req) => {
  const input = paramsInput(new URL(req.url).searchParams, CHANNEL_QUERY_PARAMS);
  const page = listChannels(input);
  return v1Json({ data: page.data, nextCursor: page.nextCursor, hasMore: page.hasMore, total: page.total, sort: page.sort });
});

export const OPTIONS = v1Options;
