import { v1Handler, v1Json, v1Options } from "@/lib/api-v1/http";
import { refreshStatus } from "@/lib/core/ingest/status";

// GET /api/v1/refresh/status — {running, run, lastRun, lastRefreshAt, nextRunAt, scheduler,
// totals: {videos, liveVideos, newVideos24h, newOutliers24h, creditsRemaining, …}}
export const GET = v1Handler(() => v1Json(refreshStatus()));

export const OPTIONS = v1Options;
