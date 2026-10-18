import { V1Error, v1Handler, v1Json, v1Options } from "@/lib/api-v1/http";
import { listRuns } from "@/lib/core/ingest/refresh";

// GET /api/v1/refresh/runs?limit=20 — recent runs, newest first.
export const GET = v1Handler((req: Request) => {
  const raw = new URL(req.url).searchParams.get("limit");
  const limit = raw == null ? 20 : Number(raw);
  if (!Number.isInteger(limit) || limit < 1 || limit > 200) throw new V1Error(400, "limit must be a whole number from 1 to 200.");
  return v1Json({ runs: listRuns(limit) });
});

export const OPTIONS = v1Options;
