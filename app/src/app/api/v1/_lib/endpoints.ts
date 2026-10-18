// Every /api/v1 endpoint, for the index route (GET /api/v1). The OpenAPI document has the details.
export const API_VERSION = "1.0.0";

export const ENDPOINTS: { method: "GET" | "POST" | "DELETE"; path: string; summary: string }[] = [
  { method: "GET", path: "/api/v1", summary: "This index: version, endpoints, library counts" },
  { method: "GET", path: "/api/v1/openapi.json", summary: "OpenAPI 3.1 document for every endpoint" },
  { method: "GET", path: "/api/v1/videos", summary: "Search and filter videos (JSON page, or JSONL/CSV with format=)" },
  { method: "GET", path: "/api/v1/videos/{videoId}", summary: "One video by YouTube id, watch URL or row id" },
  { method: "GET", path: "/api/v1/channels", summary: "Channels in the library (search, sort, paginate)" },
  { method: "GET", path: "/api/v1/channels/{channelId}", summary: "One channel (id, @handle or name) with breakdown and top videos" },
  { method: "GET", path: "/api/v1/stats", summary: "Library totals and breakdowns, last refresh" },
  { method: "GET", path: "/api/v1/taxonomy", summary: "Tiers, click triggers, niches, title formats, sorts" },
  { method: "GET", path: "/api/v1/export", summary: "Stream every matching video as JSONL or CSV (attachment)" },
  { method: "POST", path: "/api/v1/titles", summary: "Generate title angle cards for a video idea (JSON or SSE)" },
  { method: "POST", path: "/api/v1/refresh", summary: "Start a refresh run of the live outliers pipeline (202)" },
  { method: "GET", path: "/api/v1/refresh/status", summary: "Refresh pipeline status: running, last run, next run, totals" },
  { method: "GET", path: "/api/v1/refresh/runs", summary: "Recent refresh runs" },
  { method: "GET", path: "/api/v1/refresh/freshness", summary: "How fresh the library is (no API key needed)" },
  { method: "GET", path: "/api/v1/library/channels", summary: "Channels added from YouTube (followed by the refresh pipeline)" },
  { method: "POST", path: "/api/v1/library/channels", summary: "Add a channel (@handle, URL or UC id) and back it up" },
  { method: "GET", path: "/api/v1/library/channels/{channelId}", summary: "One added channel" },
  { method: "DELETE", path: "/api/v1/library/channels/{channelId}", summary: "Stop tracking a channel (?purge=1 deletes its pipeline rows)" },
];
