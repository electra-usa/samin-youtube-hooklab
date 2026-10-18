import { v1Options, v1Raw } from "@/lib/api-v1/http";
import { countVideos, exportColumns, exportStream } from "@/lib/core/query";
import { CONTENT_TYPES, EXPOSE_HEADERS, v1Route, videoParams } from "../_lib/route";

// GET /api/v1/export?format=jsonl|csv&…filters — every matching video as one streamed download
// (pages are read one at a time, so the library is never locked for the whole transfer).
// limit caps the total row count; cursor resumes from a /videos page.
export const GET = v1Route((req) => {
  const { input, output } = videoParams(new URL(req.url).searchParams, { defaultOutput: "jsonl" });
  const format = output === "csv" ? "csv" : "jsonl";
  exportColumns(input); // validates the filters before the response starts
  const total = countVideos(input);
  const stamp = new Date().toISOString().slice(0, 10);
  return v1Raw(exportStream(input, format), CONTENT_TYPES[format], {
    ...EXPOSE_HEADERS,
    "Content-Disposition": `attachment; filename="hooklab-videos-${stamp}.${format}"`,
    "X-Total-Count": String(total),
    "Cache-Control": "no-store",
  });
});

export const OPTIONS = v1Options;
