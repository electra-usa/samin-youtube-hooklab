import { CHANNEL_SORTS, CLICK_TRIGGERS, MAX_LIMIT, NICHES, SHORTS_FILTERS, TIERS, TITLE_FORMATS, VIDEO_FIELDS, VIDEO_SORTS } from "@/lib/core/query";
import { API_VERSION } from "./endpoints";

// OpenAPI 3.1 description of /api/v1 (served at GET /api/v1/openapi.json). Covers the library
// endpoints and the live refresh pipeline's endpoints (refresh/**, library/**).

type Json = Record<string, unknown>;

const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` });
const param = (name: string) => ({ $ref: `#/components/parameters/${name}` });
const nullable = (type: string, extra: Json = {}) => ({ type: [type, "null"], ...extra });
const errors = (...codes: number[]) =>
  Object.fromEntries(codes.map((c) => [String(c), { $ref: `#/components/responses/${{ 400: "BadRequest", 401: "Unauthorized", 404: "NotFound", 409: "Conflict", 500: "ServerError" }[c]}` }]));
const json = (schema: Json, description = "OK") => ({ description, content: { "application/json": { schema } } });

const VIDEO_FILTER_PARAMS = [
  "q", "mode", "minOutlier", "maxOutlier", "tier", "minViews", "maxViews", "minSubs", "maxSubs", "niche", "excludeNiche",
  "trigger", "excludeTrigger", "titleFormat", "channelIdFilter", "since", "until", "shorts", "source", "fields",
].map(param);

const schemas: Record<string, Json> = {
  Error: {
    type: "object",
    required: ["error"],
    properties: {
      error: {
        type: "object",
        required: ["code", "message"],
        properties: {
          code: { type: "string", examples: ["invalid_parameter", "invalid_cursor", "unknown_parameter", "not_found", "unauthorized", "internal_error"] },
          message: { type: "string" },
          details: { description: "Extra context, e.g. `allowed` values or channel `candidates`." },
        },
      },
    },
  },
  Video: {
    type: "object",
    description: "A library video: the Creator Hooks row shape plus tier, title format and source.",
    properties: {
      id: { type: "string", description: "Library row id (Creator Hooks id, or rss:<videoId> for rows the refresh pipeline added)." },
      videoId: { type: "string", description: "YouTube video id." },
      title: { type: "string" },
      titleLength: nullable("integer"),
      videoUrl: { type: "string", format: "uri" },
      thumbnail: { type: "string", format: "uri" },
      channelId: nullable("string"),
      channelName: nullable("string"),
      subscriberCount: nullable("integer"),
      views: nullable("integer"),
      outlierScore: nullable("number", { description: "How many times better than the channel's usual performance." }),
      tier: nullable("string", { enum: [...TIERS.map((t) => t.id), null] }),
      publishAt: nullable("string", { format: "date-time" }),
      duration: nullable("string", { description: "ISO 8601 duration, e.g. PT18M35S." }),
      durationSeconds: nullable("integer"),
      isShort: { type: "boolean" },
      frame: nullable("string", { description: "Primary title frame (analysis, tutorial, story, list, experiment, review, reaction, …)." }),
      secondaryFrame: nullable("string"),
      titleFormat: nullable("string", { enum: [...TITLE_FORMATS.map((f) => f.name), null] }),
      pov: nullable("string"),
      niches: { type: "array", items: { type: "string" } },
      clickTriggers: { type: "array", items: { type: "string" } },
      videoTypes: { type: "array", items: { type: "string" } },
      featuredInNewsletter: { type: "boolean" },
      source: { type: "string", examples: ["export", "rss"] },
      relevance: { type: "number", description: "Topic searches only: the relevance score results are ranked by." },
    },
  },
  VideoPage: {
    type: "object",
    required: ["data", "nextCursor", "hasMore"],
    properties: {
      data: { type: "array", items: ref("Video") },
      nextCursor: nullable("string", { description: "Pass as `cursor` for the next page; null on the last page." }),
      hasMore: { type: "boolean" },
      total: { type: "integer", description: "Total matches (only with count=true)." },
      sort: { type: "string", enum: VIDEO_SORTS },
      mode: nullable("string", { enum: ["topic", "keyword", null] }),
    },
  },
  Channel: {
    type: "object",
    properties: {
      channelId: { type: "string" },
      channelName: nullable("string"),
      handle: nullable("string"),
      channelUrl: { type: "string", format: "uri" },
      avatar: nullable("string"),
      subscriberCount: nullable("integer"),
      videoCount: { type: "integer", description: "Videos of this channel in the library." },
      totalViews: nullable("integer"),
      avgOutlierScore: nullable("number"),
      maxOutlierScore: nullable("number"),
      latestPublishAt: nullable("string", { format: "date-time" }),
      tracked: { type: "boolean", description: "Added to the library (library_channels), so the refresh pipeline follows it." },
      addedAt: nullable("string", { format: "date-time" }),
      lastSyncedAt: nullable("string", { format: "date-time" }),
      lastError: nullable("string"),
    },
  },
  ChannelPage: {
    type: "object",
    required: ["data", "nextCursor", "hasMore", "total"],
    properties: {
      data: { type: "array", items: ref("Channel") },
      nextCursor: nullable("string"),
      hasMore: { type: "boolean" },
      total: { type: "integer" },
      sort: { type: "string", enum: CHANNEL_SORTS },
    },
  },
  ChannelDetail: {
    type: "object",
    properties: {
      channel: ref("Channel"),
      matchedBy: { type: "string", enum: ["id", "handle", "name"] },
      breakdown: {
        type: "object",
        properties: {
          byTier: { type: "array", items: { type: "object", properties: { id: { type: "string" }, label: { type: "string" }, count: { type: "integer" } } } },
          medianOutlierScore: nullable("number"),
          topNiches: { type: "array", items: { type: "object", properties: { niche: { type: "string" }, count: { type: "integer" } } } },
          topTriggers: { type: "array", items: { type: "object", properties: { trigger: { type: "string" }, count: { type: "integer" } } } },
          titleFormats: { type: "array", items: { type: "object", properties: { titleFormat: { type: "string" }, count: { type: "integer" } } } },
          firstPublishAt: nullable("string", { format: "date-time" }),
        },
      },
      topVideos: { type: "array", items: ref("Video") },
    },
  },
  Stats: {
    type: "object",
    properties: {
      totals: {
        type: "object",
        properties: Object.fromEntries(
          ["videos", "channels", "trackedChannels", "shorts", "longform", "publishedLast7Days", "publishedLast30Days"].map((k) => [k, { type: "integer" }]),
        ),
      },
      dateRange: { type: "object", properties: { oldest: nullable("string"), newest: nullable("string") } },
      byTier: { type: "array", items: { type: "object", properties: { id: { type: "string" }, label: { type: "string" }, scoreLabel: { type: "string" }, count: { type: "integer" } } } },
      unscored: { type: "integer" },
      bySource: { type: "array", items: { type: "object", properties: { source: { type: "string" }, count: { type: "integer" } } } },
      byTitleFormat: { type: "array", items: { type: "object", properties: { titleFormat: nullable("string"), frame: nullable("string"), count: { type: "integer" } } } },
      byNiche: { type: "array", items: { type: "object", properties: { niche: { type: "string" }, count: { type: "integer" }, inTaxonomy: { type: "boolean" } } } },
      byTrigger: { type: "array", items: { type: "object", properties: { trigger: { type: "string" }, count: { type: "integer" }, inTaxonomy: { type: "boolean" } } } },
      builtAt: nullable("string", { description: "Last bulk rebuild of the library file (meta.built_at)." }),
      lastRefreshAt: nullable("string", { description: "When the last refresh run finished (falls back to builtAt)." }),
      refresh: {
        type: ["object", "null"],
        properties: {
          runs: { type: "integer" },
          lastRunId: nullable("integer"),
          lastStartedAt: nullable("string"),
          lastFinishedAt: nullable("string"),
          lastStatus: nullable("string"),
          lastNewVideos: nullable("integer"),
          lastNewOutliers: nullable("integer"),
        },
      },
      meta: { type: "object", additionalProperties: { type: "string" } },
      generatedAt: { type: "string", format: "date-time" },
    },
  },
  Taxonomy: {
    type: "object",
    properties: {
      tiers: {
        type: "array",
        items: {
          type: "object",
          properties: { id: { type: "string" }, label: { type: "string" }, scoreLabel: { type: "string" }, min: { type: "number" }, max: nullable("number") },
        },
      },
      clickTriggers: { type: "array", items: { type: "string" } },
      niches: { type: "array", items: { type: "string" } },
      titleFormats: { type: "array", items: { type: "object", properties: { name: { type: "string" }, frame: { type: "string" }, description: { type: "string" } } } },
      povs: { type: "array", items: { type: "string" } },
      searchModes: { type: "array", items: { type: "object", properties: { id: { type: "string" }, description: { type: "string" } } } },
      sorts: { type: "array", items: { type: "object", properties: { id: { type: "string" }, description: { type: "string" } } } },
    },
  },
  TitlesRequest: {
    type: "object",
    required: ["idea"],
    properties: {
      idea: { type: "string", description: "What the video is about.", examples: ["I automated my whole YouTube workflow with Claude"] },
      channelId: { type: "string", description: "One of your channels (user_channels.id or its YouTube UC… id). Default: the active channel." },
      stream: { type: "boolean", default: false, description: "Relay the generation as Server-Sent Events instead of waiting for the result." },
    },
  },
  InspirationSource: { type: "object", properties: { title: { type: "string" }, channelName: { type: "string" } } },
  ChatTitle: {
    type: "object",
    properties: {
      id: { type: "string" },
      title: { type: "string" },
      angle: { type: "string" },
      angleEmoji: { type: "string" },
      clickTrigger: { type: "string", description: "1–2 click triggers joined with \" + \"." },
      derivation: { type: "string", description: "skeleton:<videoId>, how the skeleton's slots were filled." },
      inspirationSources: { type: "array", items: ref("InspirationSource") },
    },
  },
  AngleCard: {
    type: "object",
    properties: {
      id: { type: "string" },
      name: { type: "string" },
      emoji: { type: "string" },
      description: { type: "string" },
      titles: { type: "array", items: ref("ChatTitle") },
      isRecommended: { type: "boolean" },
      recommendationReason: { type: "string" },
    },
  },
  VideoRef: {
    type: "object",
    properties: {
      title: { type: "string" },
      views: { type: "string" },
      outlierScore: { type: "string" },
      channelName: { type: "string" },
      videoId: { type: "string" },
      publishedAt: nullable("string"),
    },
  },
  TitlesResult: {
    type: "object",
    properties: {
      chatId: { type: "string" },
      chatUrl: { type: "string", format: "uri", description: "Open the answer in the HookLab app." },
      messageId: { type: "string" },
      generationId: { type: "string" },
      intent: nullable("string", { examples: ["titles"] }),
      topic: nullable("string"),
      summary: { type: "string" },
      angleCards: { type: "array", items: ref("AngleCard") },
      bodyMarkdown: { type: "string" },
      markdown: nullable("string", { description: "Set instead of angleCards when the request was answered in prose." }),
      suggestedFollowups: { type: "array", items: { type: "string" } },
      videoMap: { type: "object", additionalProperties: ref("VideoRef"), description: "Library videos the titles were modeled on, keyed by lowercased title." },
      provider: nullable("string", { examples: ["anthropic", "claude-code"] }),
      model: nullable("string"),
      credits: nullable("integer"),
      durationMs: { type: "integer" },
    },
  },
  RefreshRun: {
    type: "object",
    properties: {
      id: { type: "integer" },
      startedAt: { type: "string", format: "date-time" },
      finishedAt: nullable("string", { format: "date-time" }),
      status: { type: "string", enum: ["running", "ok", "partial", "failed", "aborted", "dry_run"] },
      trigger: { type: "string", examples: ["api", "cli", "scheduler"] },
      dryRun: { type: "boolean" },
      channelsPlanned: { type: "integer" },
      channelsPolled: { type: "integer" },
      requests: { type: "integer" },
      newVideos: { type: "integer" },
      updatedVideos: { type: "integer" },
      newOutliers: { type: "integer" },
      enriched: { type: "integer" },
      tagged: { type: "integer" },
      discoveredChannels: { type: "integer" },
      creditsUsed: { type: "integer" },
      aiCostUsd: { type: "number" },
      errors: { type: "integer" },
      errorSample: { type: "array", items: { type: "string" } },
      options: { type: "object" },
    },
  },
  RefreshRequest: {
    type: "object",
    properties: {
      channels: { type: "integer", minimum: 0, maximum: 5000, description: "Channels to poll this run (default HOOKLAB_REFRESH_CHANNELS, 300). 0 skips polling." },
      channelIds: { type: "array", items: { type: "string", pattern: "^UC[\\w-]{22}$" }, description: "Poll exactly these channels instead of the due ones." },
      concurrency: { type: "integer", minimum: 1, maximum: 16 },
      discover: { type: "boolean", description: "Force channel discovery on or off for this run (default: HOOKLAB_DISCOVER and its interval)." },
      discoverQueries: { type: "integer", minimum: 1, maximum: 20 },
      tagging: { type: "string", enum: ["outliers", "all", "off"], description: "Which new videos get niches/click triggers from Claude." },
      dryRun: { type: "boolean", description: "Fetch and score, but write nothing." },
    },
  },
  LockState: {
    type: "object",
    properties: {
      owner: { type: "string" },
      host: { type: "string" },
      startedAt: { type: "string", format: "date-time" },
      heartbeatAt: { type: "string", format: "date-time" },
      stale: { type: "boolean" },
    },
  },
  SchedulerState: {
    type: "object",
    properties: {
      owner: { type: "string" },
      pid: { type: "integer" },
      host: { type: "string" },
      everyMinutes: { type: "number" },
      nextRunAt: nullable("string", { format: "date-time" }),
      updatedAt: { type: "string", format: "date-time" },
      active: { type: "boolean" },
    },
  },
  RefreshStatus: {
    type: "object",
    properties: {
      running: { type: "boolean" },
      run: { oneOf: [ref("RefreshRun"), { type: "null" }], description: "The run in progress." },
      lock: { oneOf: [ref("LockState"), { type: "null" }] },
      lastRun: { oneOf: [ref("RefreshRun"), { type: "null" }], description: "The last finished (non-dry) run." },
      lastRefreshAt: nullable("string", { format: "date-time" }),
      nextRunAt: nullable("string", { format: "date-time", description: "Next scheduled run when the in-process scheduler is on." }),
      scheduler: { oneOf: [ref("SchedulerState"), { type: "null" }] },
      totals: {
        type: "object",
        properties: Object.fromEntries(
          ["videos", "liveVideos", "pipelineVideos", "newVideos24h", "newOutliers24h", "libraryChannels", "channelsPolled24h", "creditsRemaining", "creditsUsed24h", "dailyCreditBudget"].map(
            (k) => [k, nullable("number")],
          ),
        ),
      },
    },
  },
  Freshness: {
    type: "object",
    properties: {
      updatedAt: nullable("string", { format: "date-time", description: "Latest of lastRefreshAt and builtAt." }),
      lastRefreshAt: nullable("string", { format: "date-time" }),
      builtAt: nullable("string", { format: "date-time" }),
      running: { type: "boolean" },
      newVideos24h: { type: "integer" },
      newOutliers24h: { type: "integer" },
    },
  },
  BackfillResult: {
    type: "object",
    properties: {
      channelId: { type: "string" },
      videos: { type: "integer" },
      newVideos: { type: "integer" },
      updatedVideos: { type: "integer" },
      outliers: { type: "integer" },
      deep: { type: "boolean" },
      error: nullable("string"),
    },
  },
  LibraryChannel: {
    type: "object",
    properties: {
      channelId: { type: "string" },
      handle: nullable("string"),
      name: nullable("string"),
      avatar: nullable("string"),
      subscriberCount: nullable("integer"),
      addedAt: { type: "string", format: "date-time" },
      lastSyncedAt: nullable("string", { format: "date-time" }),
      lastError: nullable("string"),
      source: { type: "string", enum: ["user", "discovered"] },
      videos: { type: "integer" },
      outliers: { type: "integer" },
      lastPolledAt: nullable("string", { format: "date-time" }),
      lastUploadAt: nullable("string", { format: "date-time" }),
    },
  },
  AddLibraryChannelRequest: {
    type: "object",
    required: ["channel"],
    properties: {
      channel: { type: "string", description: "@handle, channel URL, video URL or UC… id.", examples: ["@mkbhd"] },
      backfill: { type: "boolean", description: "Poll its feeds right away and store the recent uploads (default true)." },
      deep: { type: "boolean", description: "Also fetch one ScrapeCreators page (~30 uploads) when credits allow." },
    },
  },
};

const listParam = (name: string, description: string, examples: string[]) => ({
  name,
  in: "query",
  description: `${description} Repeat the parameter or separate values with commas.`,
  style: "form",
  explode: true,
  schema: { type: "array", items: { type: "string" } },
  examples: { one: { value: examples.slice(0, 1) }, several: { value: examples } },
});

const parameters: Record<string, Json> = {
  q: { name: "q", in: "query", description: "Search text, matched against titles.", schema: { type: "string", maxLength: 300 } },
  mode: {
    name: "mode",
    in: "query",
    description: "topic (default): any stemmed term matches and results rank by relevance (BM25, a match needs half the query's term weight or the whole phrase). keyword: every word must appear; \"quoted phrases\" stay together.",
    schema: { type: "string", enum: ["topic", "keyword"], default: "topic" },
  },
  minOutlier: { name: "minOutlier", in: "query", description: "Minimum outlier score (inclusive). `5` or `5x`.", schema: { type: "string" }, example: "5" },
  maxOutlier: { name: "maxOutlier", in: "query", description: "Maximum outlier score (inclusive).", schema: { type: "string" } },
  tier: {
    ...listParam("tier", `Performance tiers (ids or labels): ${TIERS.map((t) => `${t.id} ${t.scoreLabel}`).join(", ")}.`, ["bangers", "mega_bangers"]),
    schema: { type: "array", items: { type: "string", enum: TIERS.map((t) => t.id) } },
  },
  minViews: { name: "minViews", in: "query", description: "Minimum views. Accepts 10000, 10k, 1.5M.", schema: { type: "string" } },
  maxViews: { name: "maxViews", in: "query", description: "Maximum views.", schema: { type: "string" } },
  minSubs: { name: "minSubs", in: "query", description: "Minimum channel subscribers.", schema: { type: "string" } },
  maxSubs: { name: "maxSubs", in: "query", description: "Maximum channel subscribers.", schema: { type: "string" } },
  niche: listParam("niche", `Videos in any of these niches (${NICHES.length}; see /taxonomy; case and punctuation are ignored).`, ["Technology", "Finance"]),
  excludeNiche: listParam("excludeNiche", "Leave out videos in any of these niches.", ["News & Politics", "Legal"]),
  trigger: listParam("trigger", `Videos with any of these click triggers (${CLICK_TRIGGERS.length}; see /taxonomy).`, ["Curiosity", "Time Frame"]),
  excludeTrigger: listParam("excludeTrigger", "Leave out videos with any of these click triggers.", ["Negativity"]),
  titleFormat: {
    ...listParam("titleFormat", `Title formats (or their frames): ${TITLE_FORMATS.map((f) => `${f.name} → ${f.frame}`).join(", ")}. Also accepted as \`format\`.`, ["Tutorial", "List"]),
  },
  format: {
    name: "format",
    in: "query",
    description: "Response format: json, jsonl or csv. Any other value is read as a title-format filter (same as titleFormat).",
    schema: { type: "string", examples: ["json", "jsonl", "csv"] },
  },
  channelIdFilter: listParam("channelId", "Only these channels: UC… ids, @handles, channel URLs or exact channel names.", ["UCLKPca3kwwd-B59HNr-_lvA"]),
  since: {
    name: "since",
    in: "query",
    description: "Published at or after: 2026-09-30, 2026-09, a timestamp, or an age like 24h, 7d, 2w, 3m, 1y. Relative values are fixed on the first page.",
    schema: { type: "string" },
    example: "30d",
  },
  until: { name: "until", in: "query", description: "Published before (a date includes that whole day). Same formats as since.", schema: { type: "string" } },
  shorts: { name: "shorts", in: "query", description: "Include Shorts (default), only Shorts, or exclude them.", schema: { type: "string", enum: SHORTS_FILTERS, default: "include" } },
  source: listParam("source", "Row origin.", ["export", "rss"]),
  sort: {
    name: "sort",
    in: "query",
    description: "relevance (default for topic searches), newest (default otherwise), outlier, views, subscribers. Always descending.",
    schema: { type: "string", enum: VIDEO_SORTS },
  },
  limit: { name: "limit", in: "query", description: `Rows per page, 1–${MAX_LIMIT} (larger values are capped).`, schema: { type: "integer", minimum: 1, maximum: MAX_LIMIT, default: 50 } },
  cursor: { name: "cursor", in: "query", description: "nextCursor from the previous page. Must be used with the same filters and sort.", schema: { type: "string" } },
  fields: {
    name: "fields",
    in: "query",
    description: `Comma-separated output fields: ${[...VIDEO_FIELDS, "relevance"].join(", ")}.`,
    schema: { type: "string" },
    example: "videoId,title,outlierScore,views",
  },
  count: { name: "count", in: "query", description: "Also return the total number of matches.", schema: { type: "boolean", default: false } },
  exportFormat: {
    name: "format",
    in: "query",
    description: "jsonl (default) or csv. Any other value is read as a title-format filter.",
    schema: { type: "string", default: "jsonl", examples: ["jsonl", "csv"] },
  },
  exportLimit: { name: "limit", in: "query", description: "Stop after this many rows (default: no limit).", schema: { type: "integer", minimum: 1 } },
};

const pagingHeaders = {
  "X-Next-Cursor": { description: "Cursor for the next page (absent on the last page).", schema: { type: "string" } },
  "X-Has-More": { description: "Whether another page exists.", schema: { type: "string", enum: ["true", "false"] } },
  "X-Total-Count": { description: "Total matches (with count=true).", schema: { type: "integer" } },
};

export function openApiDocument(serverUrl: string): Json {
  return {
    openapi: "3.1.0",
    info: {
      title: "HookLab API",
      version: API_VERSION,
      summary: "The HookLab outlier video library, its live refresh pipeline, and title generation.",
      description: [
        "Read the outlier library (videos, channels, stats, taxonomy), stream exports, generate titles, and drive the live refresh pipeline.",
        "",
        "**Auth.** Off unless the server has `HOOKLAB_API_KEY` set; then every call needs `Authorization: Bearer <key>` or `x-api-key: <key>`.",
        "",
        "**Pagination.** List endpoints return `nextCursor`; pass it back as `cursor` with the same filters. Cursors are keyset-based (sort key + row id), so pages stay consistent while the refresh pipeline inserts videos.",
        "",
        "**Errors.** `{\"error\": {\"code\", \"message\", \"details?\"}}` with a 4xx/5xx status.",
        "",
        "The same queries are available from the `hooklab` CLI (docs/CLI.md).",
      ].join("\n"),
      license: { name: "MIT", identifier: "MIT" },
    },
    servers: [{ url: serverUrl, description: "This HookLab server" }],
    security: [{ bearerAuth: [] }, { apiKeyHeader: [] }, {}],
    tags: [
      { name: "Library", description: "Videos, channels, stats and taxonomy." },
      { name: "Titles", description: "Title generation with the chat pipeline." },
      { name: "Refresh", description: "The live outliers pipeline (RSS polling, scoring, discovery)." },
      { name: "Meta", description: "Index and this document." },
    ],
    paths: {
      "/api/v1": {
        get: {
          tags: ["Meta"],
          operationId: "getIndex",
          summary: "API index",
          description: "Version, auth mode, library counts and the endpoint list.",
          responses: { 200: json({ type: "object" }), ...errors(401) },
        },
      },
      "/api/v1/openapi.json": {
        get: { tags: ["Meta"], operationId: "getOpenApi", summary: "This OpenAPI document", responses: { 200: json({ type: "object" }), ...errors(401) } },
      },
      "/api/v1/videos": {
        get: {
          tags: ["Library"],
          operationId: "searchVideos",
          summary: "Search and filter videos",
          description:
            "One page of videos matching every filter given. `format=jsonl|csv` returns this page's rows as JSONL/CSV with the paging info in headers; use /api/v1/export for everything.",
          parameters: [...VIDEO_FILTER_PARAMS, param("format"), param("sort"), param("limit"), param("cursor"), param("count")],
          responses: {
            200: {
              description: "A page of videos.",
              headers: pagingHeaders,
              content: {
                "application/json": { schema: ref("VideoPage") },
                "application/x-ndjson": { schema: { type: "string", description: "One Video JSON object per line." } },
                "text/csv": { schema: { type: "string", description: "Header row + one row per video; lists joined with |." } },
              },
            },
            ...errors(400, 401, 500),
          },
        },
      },
      "/api/v1/videos/{videoId}": {
        get: {
          tags: ["Library"],
          operationId: "getVideo",
          summary: "One video",
          parameters: [{ name: "videoId", in: "path", required: true, description: "YouTube video id, URL-encoded watch/shorts URL, or library row id.", schema: { type: "string" } }],
          responses: { 200: json({ type: "object", properties: { data: ref("Video") } }), ...errors(401, 404) },
        },
      },
      "/api/v1/channels": {
        get: {
          tags: ["Library"],
          operationId: "listChannels",
          summary: "List channels",
          parameters: [
            { name: "q", in: "query", description: "Matches channel names and handles (case, spaces and punctuation ignored).", schema: { type: "string" } },
            { name: "sort", in: "query", description: "videos (default), subscribers, outlier (best video), avgOutlier, views (total), latest, name (A–Z).", schema: { type: "string", enum: CHANNEL_SORTS } },
            { name: "tracked", in: "query", description: "Only channels the refresh pipeline follows (library_channels).", schema: { type: "boolean" } },
            { name: "limit", in: "query", schema: { type: "integer", minimum: 1, maximum: 1000, default: 50 } },
            param("cursor"),
          ],
          responses: { 200: json(ref("ChannelPage")), ...errors(400, 401) },
        },
      },
      "/api/v1/channels/{channelId}": {
        get: {
          tags: ["Library"],
          operationId: "getChannel",
          summary: "One channel with breakdown and top videos",
          parameters: [
            { name: "channelId", in: "path", required: true, description: "UC… id, @handle, URL-encoded channel URL, or channel name.", schema: { type: "string" } },
            { name: "videos", in: "query", description: "Top videos by outlier score to include (0–100).", schema: { type: "integer", minimum: 0, maximum: 100, default: 10 } },
          ],
          responses: { 200: json({ type: "object", properties: { data: ref("ChannelDetail") } }), ...errors(400, 401, 404) },
        },
      },
      "/api/v1/stats": {
        get: {
          tags: ["Library"],
          operationId: "getStats",
          summary: "Library totals and breakdowns",
          responses: { 200: json({ type: "object", properties: { data: ref("Stats") } }), ...errors(401) },
        },
      },
      "/api/v1/taxonomy": {
        get: {
          tags: ["Library"],
          operationId: "getTaxonomy",
          summary: "Filter vocabularies",
          responses: { 200: json({ type: "object", properties: { data: ref("Taxonomy") } }), ...errors(401) },
        },
      },
      "/api/v1/export": {
        get: {
          tags: ["Library"],
          operationId: "exportVideos",
          summary: "Stream every matching video",
          description: "All videos matching the filters as one download (format=jsonl, the default, or csv). `limit` caps the total row count; `cursor` resumes from a /videos page.",
          parameters: [...VIDEO_FILTER_PARAMS, param("exportFormat"), param("sort"), param("exportLimit"), param("cursor")],
          responses: {
            200: {
              description: "The export, streamed.",
              headers: {
                "Content-Disposition": { schema: { type: "string" }, description: "attachment; filename=\"hooklab-videos-<date>.<format>\"" },
                "X-Total-Count": { schema: { type: "integer" }, description: "Rows the export will contain (before limit)." },
              },
              content: {
                "application/x-ndjson": { schema: { type: "string" } },
                "text/csv": { schema: { type: "string" } },
              },
            },
            ...errors(400, 401),
          },
        },
      },
      "/api/v1/titles": {
        post: {
          tags: ["Titles"],
          operationId: "generateTitles",
          summary: "Generate title angle cards for a video idea",
          description:
            "Runs the chat title pipeline (Claude, grounded in real outlier videos from the library) and creates a chat, so the answer also appears in the app. Takes about 40 seconds. With `stream: true` the response is the pipeline's Server-Sent Events: a leading `{chat}` event, progress (`tool_status`/`tool_name`), `title`, `card`, `chat_title`, `error` and a final `done` event; every event is `data: <json>` with `\"version\":\"1.0\"`.",
          requestBody: { required: true, content: { "application/json": { schema: ref("TitlesRequest") } } },
          responses: {
            200: {
              description: "The finished cards (stream:false) or the event stream (stream:true).",
              content: {
                "application/json": { schema: { type: "object", properties: { data: ref("TitlesResult") } } },
                "text/event-stream": { schema: { type: "string" } },
              },
            },
            ...errors(400, 401),
            502: {
              description: "The generation failed (provider error, bad output). The chat still exists.",
              content: { "application/json": { schema: { allOf: [ref("Error"), { type: "object", properties: { chatId: { type: "string" }, chatUrl: { type: "string" } } }] } } },
            },
            503: { description: "No Claude provider is configured.", content: { "application/json": { schema: ref("Error") } } },
          },
        },
      },
      "/api/v1/refresh": {
        post: {
          tags: ["Refresh"],
          operationId: "startRefresh",
          summary: "Start a refresh run",
          description: "Polls the due channels' RSS feeds, scores new uploads, tags outliers and (optionally) discovers channels. Answers right away; follow the run with /api/v1/refresh/status.",
          requestBody: { required: false, content: { "application/json": { schema: ref("RefreshRequest") } } },
          responses: {
            202: json({ type: "object", properties: { run: ref("RefreshRun"), status: { type: "string", examples: ["/api/v1/refresh/status"] } } }, "The run that started."),
            ...errors(400, 401),
            409: {
              description: "Another run (CLI worker, scheduler or API) holds the lock.",
              content: { "application/json": { schema: { allOf: [ref("Error"), { type: "object", properties: { run: { oneOf: [ref("RefreshRun"), { type: "null" }] } } }] } } },
            },
          },
        },
      },
      "/api/v1/refresh/status": {
        get: {
          tags: ["Refresh"],
          operationId: "getRefreshStatus",
          summary: "Refresh pipeline status",
          responses: { 200: json(ref("RefreshStatus")), ...errors(401) },
        },
      },
      "/api/v1/refresh/runs": {
        get: {
          tags: ["Refresh"],
          operationId: "listRefreshRuns",
          summary: "Recent refresh runs, newest first",
          parameters: [{ name: "limit", in: "query", schema: { type: "integer", minimum: 1, maximum: 200, default: 20 } }],
          responses: { 200: json({ type: "object", properties: { runs: { type: "array", items: ref("RefreshRun") } } }), ...errors(400, 401) },
        },
      },
      "/api/v1/refresh/freshness": {
        get: {
          tags: ["Refresh"],
          operationId: "getFreshness",
          summary: "How fresh the library is (no API key needed)",
          description: "Used by the Outliers page header; readable without the API key because it exposes nothing the UI doesn't show.",
          security: [],
          responses: { 200: json(ref("Freshness")) },
        },
      },
      "/api/v1/library/channels": {
        get: {
          tags: ["Refresh"],
          operationId: "listLibraryChannels",
          summary: "Channels added from YouTube (by you or discovery)",
          responses: { 200: json({ type: "object", properties: { channels: { type: "array", items: ref("LibraryChannel") } } }), ...errors(401) },
        },
        post: {
          tags: ["Refresh"],
          operationId: "addLibraryChannel",
          summary: "Add a channel to the library",
          description: "Resolves the channel, backs it up with its recent uploads, and gives it priority in the refresh rotation. 201 when newly added, 200 when it was already there.",
          requestBody: { required: true, content: { "application/json": { schema: ref("AddLibraryChannelRequest") } } },
          responses: {
            200: json(
              { type: "object", properties: { channel: ref("LibraryChannel"), created: { type: "boolean" }, backfill: { oneOf: [ref("BackfillResult"), { type: "null" }] } } },
              "Already in the library (refreshed).",
            ),
            201: json(
              { type: "object", properties: { channel: ref("LibraryChannel"), created: { type: "boolean" }, backfill: { oneOf: [ref("BackfillResult"), { type: "null" }] } } },
              "Added.",
            ),
            ...errors(400, 401, 404),
          },
        },
      },
      "/api/v1/library/channels/{channelId}": {
        get: {
          tags: ["Refresh"],
          operationId: "getLibraryChannel",
          summary: "One added channel",
          parameters: [{ name: "channelId", in: "path", required: true, schema: { type: "string" } }],
          responses: { 200: json({ type: "object", properties: { channel: ref("LibraryChannel") } }), ...errors(401, 404) },
        },
        delete: {
          tags: ["Refresh"],
          operationId: "removeLibraryChannel",
          summary: "Stop tracking a channel",
          description: "Removes it from library_channels and pauses its polling. `purge=1` also deletes the videos the pipeline stored for it; export rows stay.",
          parameters: [
            { name: "channelId", in: "path", required: true, schema: { type: "string" } },
            { name: "purge", in: "query", schema: { type: "boolean", default: false } },
          ],
          responses: {
            200: json({
              type: "object",
              properties: { channelId: { type: "string" }, removed: { type: "boolean" }, paused: { type: "boolean" }, purged: { type: "integer" } },
            }),
            ...errors(401, 404),
          },
        },
      },
    },
    components: {
      securitySchemes: {
        bearerAuth: { type: "http", scheme: "bearer", description: "HOOKLAB_API_KEY as a bearer token (only enforced when the server sets it)." },
        apiKeyHeader: { type: "apiKey", in: "header", name: "x-api-key", description: "HOOKLAB_API_KEY in the x-api-key header." },
      },
      parameters,
      schemas,
      responses: {
        BadRequest: { description: "Invalid parameters, body or cursor.", content: { "application/json": { schema: ref("Error") } } },
        Unauthorized: { description: "HOOKLAB_API_KEY is set and the request didn't carry it.", content: { "application/json": { schema: ref("Error") } } },
        NotFound: { description: "No such video or channel.", content: { "application/json": { schema: ref("Error") } } },
        Conflict: { description: "A refresh is already running.", content: { "application/json": { schema: ref("Error") } } },
        ServerError: { description: "Unexpected error.", content: { "application/json": { schema: ref("Error") } } },
      },
    },
  };
}
