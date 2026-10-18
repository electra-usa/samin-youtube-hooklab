import { v1Json, v1Options } from "@/lib/api-v1/http";
import { libraryFreshness } from "@/lib/core/ingest/status";

// GET /api/v1/refresh/freshness — {updatedAt, lastRefreshAt, builtAt, running, newVideos24h,
// newOutliers24h} for the Outliers page header. Deliberately readable without the API key:
// the browser UI has no key, and this exposes nothing the UI doesn't already show.
export function GET() {
  return v1Json(libraryFreshness(), { headers: { "Cache-Control": "no-store" } });
}

export const OPTIONS = v1Options;
