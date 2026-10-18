import { v1Json, v1Options, v1Raw } from "@/lib/api-v1/http";
import { csvLine, exportColumns, searchVideos } from "@/lib/core/query";
import { CONTENT_TYPES, EXPOSE_HEADERS, v1Route, videoParams } from "../_lib/route";

// GET /api/v1/videos — one page of videos matching the filters (keyset cursor pagination).
// format=json (default) → {data, nextCursor, hasMore, total?}; format=jsonl|csv → this page's
// rows, with the next cursor in the X-Next-Cursor header. GET /api/v1/export streams every page.
export const GET = v1Route((req) => {
  const { input, output } = videoParams(new URL(req.url).searchParams);
  const page = searchVideos(input);
  if (output === "json") {
    return v1Json({
      data: page.data,
      nextCursor: page.nextCursor,
      hasMore: page.hasMore,
      ...(page.total != null ? { total: page.total } : {}),
      sort: page.sort,
      mode: page.mode,
    });
  }
  const rows = page.data as Record<string, unknown>[];
  const body =
    output === "csv"
      ? (() => {
          const columns = exportColumns(input);
          return csvLine(columns) + rows.map((r) => csvLine(columns.map((c) => r[c]))).join("");
        })()
      : rows.map((r) => `${JSON.stringify(r)}\n`).join("");
  return v1Raw(body, CONTENT_TYPES[output], {
    ...EXPOSE_HEADERS,
    "X-Has-More": String(page.hasMore),
    ...(page.nextCursor ? { "X-Next-Cursor": page.nextCursor } : {}),
    ...(page.total != null ? { "X-Total-Count": String(page.total) } : {}),
  });
});

export const OPTIONS = v1Options;
