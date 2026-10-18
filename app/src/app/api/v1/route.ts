import { v1Json, v1Options } from "@/lib/api-v1/http";
import { libraryCounts } from "@/lib/core/query";
import { API_VERSION, ENDPOINTS } from "./_lib/endpoints";
import { origin, v1Route } from "./_lib/route";

// GET /api/v1 — API index: version, auth mode, library counts and the endpoint list.
export const GET = v1Route((req) => {
  const base = origin(req);
  return v1Json({
    name: "HookLab API",
    version: API_VERSION,
    docs: { openapi: `${base}/api/v1/openapi.json`, guide: "docs/API.md" },
    auth: {
      required: !!process.env.HOOKLAB_API_KEY,
      schemes: ["Authorization: Bearer <HOOKLAB_API_KEY>", "x-api-key: <HOOKLAB_API_KEY>"],
    },
    library: libraryCounts(),
    endpoints: ENDPOINTS.map((e) => ({ ...e, url: `${base}${e.path}` })),
  });
});

export const OPTIONS = v1Options;
