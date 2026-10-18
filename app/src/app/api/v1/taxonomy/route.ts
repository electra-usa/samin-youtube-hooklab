import { v1Json, v1Options } from "@/lib/api-v1/http";
import { taxonomy } from "@/lib/core/query";
import { v1Route } from "../_lib/route";

// GET /api/v1/taxonomy — the values the video filters accept: tiers (score ranges), the 48 click
// triggers, the 45 niches, the 7 title formats (and their frames), POVs, search modes and sorts.
export const GET = v1Route(() => v1Json({ data: taxonomy() }));

export const OPTIONS = v1Options;
