import { v1Json, v1Options } from "@/lib/api-v1/http";
import { libraryStats } from "@/lib/core/query";
import { v1Route } from "../_lib/route";

// GET /api/v1/stats — library totals and breakdowns (tiers, sources, title formats, niches,
// click triggers), date range, rebuild time and the latest refresh run.
export const GET = v1Route(() => v1Json({ data: libraryStats() }));

export const OPTIONS = v1Options;
