# HookLab REST API (`/api/v1`)

A stable JSON API over the outlier library, title generation and the live refresh pipeline. It runs inside the HookLab app (`hooklab serve` or `cd app && npm run dev -- -p 3210`), at `http://localhost:3210/api/v1`. The library endpoints share their query code with the `hooklab` CLI (`app/src/lib/core/query/`), so both return the same rows for the same filters. The full machine-readable description is the OpenAPI 3.1 document at **`GET /api/v1/openapi.json`** (validated with `openapi-spec-validator`).

The API is a HookLab addition; the original Creator Hooks had no public API.

- [Auth](#auth) · [Conventions](#conventions) · [Errors](#errors) · [Pagination](#pagination) · [Endpoints](#endpoints) · [Video object](#video-object) · [Notes](#notes)

## Auth

Off by default. Set `HOOKLAB_API_KEY` in `app/.env.local` (and restart the server) to require it on every `/api/v1` call, as either header:

```bash
curl -H "Authorization: Bearer $HOOKLAB_API_KEY" http://localhost:3210/api/v1/stats
curl -H "x-api-key: $HOOKLAB_API_KEY"            http://localhost:3210/api/v1/stats
```

Without it (or with a wrong key) every endpoint answers `401 {"error":{"code":"unauthorized","message":"Missing or invalid API key."}}`. Exceptions: `OPTIONS` preflights, and `GET /api/v1/refresh/freshness` (the app's own Outliers header reads it). CORS allows any origin unless `HOOKLAB_CORS_ORIGIN` is set; methods `GET, POST, DELETE, OPTIONS`; headers `Authorization, Content-Type, x-api-key`; CSV/JSONL paging headers are exposed to browsers.

## Conventions

- Single objects come wrapped as `{"data": {…}}`; lists as `{"data": [...], "nextCursor", "hasMore", …}`. (The refresh/library endpoints use their own keys: `{run}`, `{runs}`, `{channels}`, `{channel}`.)
- Query parameters are camelCase. List parameters (`niche`, `trigger`, `tier`, …) can repeat (`niche=Finance&niche=Health`) or use commas (`niche=Finance,Health`). Unknown parameters are rejected with 400, so typos don't silently return unfiltered data (parameters starting with `_` are ignored, e.g. cache busters).
- Numbers accept suffixes: `minViews=100k`, `maxSubs=1.5M`, `minOutlier=5x`.
- Dates are ISO 8601 UTC strings (`2026-10-18T17:15:30.000Z`).

## Errors

```json
{ "error": { "code": "invalid_parameter", "message": "Unknown tier \"huge\". …", "details": { "allowed": ["flops", "…"] } } }
```

| Status | `code` | When |
|---|---|---|
| 400 | `invalid_parameter` | A value is out of range or not in the vocabulary (`details.allowed` lists valid values) |
| 400 | `unknown_parameter` | A query parameter the endpoint doesn't take |
| 400 | `invalid_cursor` | The cursor is malformed, or belongs to a different query |
| 400 | `ambiguous_channel` | A channel name matches several channels (`details.candidates`) |
| 400 | `channel_not_found` | A `channelId` filter that is a handle/name matches nothing |
| 400 | `invalid_body` / `invalid_json` / `bad_request` | Missing or malformed JSON body |
| 401 | `unauthorized` | `HOOKLAB_API_KEY` is set and the request didn't carry it |
| 404 | `not_found` | No such video or channel |
| 409 | `refresh_running` | Another refresh run holds the lock |
| 502 / 503 | provider codes (`no_provider`, `rate_limit`, `timeout`, …) | Title generation failed / no Claude provider configured |
| 500 | `internal_error` | Unexpected; the message says what failed |

## Pagination

List endpoints return `nextCursor` (null on the last page) and `hasMore`. Pass the cursor back unchanged with the **same filters and sort**:

```bash
curl -s 'http://localhost:3210/api/v1/videos?tier=bangers&sort=outlier&limit=100' | jq -r .nextCursor
curl -s 'http://localhost:3210/api/v1/videos?tier=bangers&sort=outlier&limit=100&cursor=eyJ2Ijox…'
```

Cursors are keyset-based: they carry the last row's sort key and row id (ordering is always the sort key descending, then id), plus values frozen on the first page: relative dates like `since=7d` resolve once, and topic searches keep their term weights. So walking a listing never repeats or skips rows while the refresh pipeline inserts new videos (verified: a full walk of the pipeline's `source=rss` rows in 37-row pages while it was inserting returned every row exactly once). Two caveats: a cursor is rejected (`invalid_cursor`) if the filters change, and a row whose sort value changes during a walk (e.g. views refreshed while paging `sort=views`) can move across the cursor. `limit` is 1–1000 (larger values are capped); `fields` and `limit` may change between pages.

## Endpoints

| Method | Path | Purpose |
|---|---|---|
| GET | [`/api/v1`](#get-apiv1) | Index: version, auth mode, library counts, endpoint list |
| GET | [`/api/v1/videos`](#get-apiv1videos) | Search and filter videos |
| GET | [`/api/v1/videos/{videoId}`](#get-apiv1videosvideoid) | One video |
| GET | [`/api/v1/channels`](#get-apiv1channels) | List channels |
| GET | [`/api/v1/channels/{channelId}`](#get-apiv1channelschannelid) | One channel with breakdown and top videos |
| GET | [`/api/v1/stats`](#get-apiv1stats) | Library totals and breakdowns |
| GET | [`/api/v1/taxonomy`](#get-apiv1taxonomy) | Filter vocabularies |
| GET | [`/api/v1/export`](#get-apiv1export) | Stream every matching video (JSONL/CSV) |
| POST | [`/api/v1/titles`](#post-apiv1titles) | Generate title angle cards for an idea |
| GET | `/api/v1/openapi.json` | OpenAPI 3.1 document |
| POST, GET | [`/api/v1/refresh`, `/refresh/status`, `/refresh/runs`, `/refresh/freshness`](#refresh-pipeline) | Live outliers pipeline |
| GET, POST, DELETE | [`/api/v1/library/channels[/{channelId}]`](#library-channels) | Channels the pipeline follows |

### GET /api/v1

```bash
curl -s http://localhost:3210/api/v1 | jq '{version, auth, library}'
```

```json
{
  "version": "1.0.0",
  "auth": { "required": false, "schemes": ["Authorization: Bearer <HOOKLAB_API_KEY>", "x-api-key: <HOOKLAB_API_KEY>"] },
  "library": { "videos": 296720, "channels": 8384, "trackedChannels": 0, "builtAt": "2026-10-18T21:23:46Z", "lastRefreshAt": "2026-10-18T21:21:29.305Z" }
}
```

### GET /api/v1/videos

One page of videos matching every filter given.

| Parameter | Meaning |
|---|---|
| `q` | Search text (titles) |
| `mode` | `topic` (default): any stemmed term, ranked by relevance (BM25-style; a match needs half the query's word weight or the whole phrase). `keyword`: every word; `"quoted phrases"` stay together |
| `minOutlier`, `maxOutlier` | Outlier score range, inclusive |
| `tier` | `flops` (<0.3x), `below_avg` (0.3–1x), `pretty_good` (1–2x), `above_avg` (2–4x), `great` (4–10x), `bangers` (10–50x), `mega_bangers` (≥50x); several combine |
| `minViews`, `maxViews` | Views |
| `minSubs`, `maxSubs` | Channel subscribers |
| `niche`, `excludeNiche` | Any of / none of these niches (the 45 in `/taxonomy`; case and punctuation ignored) |
| `trigger`, `excludeTrigger` | Any of / none of these click triggers (the 48 in `/taxonomy`) |
| `titleFormat` | Challenge, Tutorial, Explainer, List, Story, Review, Reaction (matched against `frame`/`secondaryFrame`: experiment, tutorial, analysis, list, story, review, reaction) |
| `format` | `json` (default), `jsonl` or `csv` response; any other value is read as a `titleFormat` filter |
| `channelId` | `UC…` ids, `@handles`, channel URLs or exact channel names |
| `since`, `until` | Publish date: `2026-09-30`, `2026-09`, `2026`, a timestamp, `today`, `yesterday`, or an age `24h`, `7d`, `2w`, `3m`, `1y`. `until` with a date includes that whole day |
| `shorts` | `include` (default), `only`, `exclude` |
| `source` | Row origin: `export`, `rss` |
| `sort` | `relevance` (default for topic searches), `newest` (default otherwise), `outlier`, `views`, `subscribers` |
| `limit` | 1–1000, default 50 |
| `cursor` | From the previous page |
| `fields` | Comma-separated subset of the [video fields](#video-object), in that order |
| `count` | `true` adds `total` (the number of matches) |

```bash
# Topic search, recent strong outliers, a few fields
curl -s 'http://localhost:3210/api/v1/videos?q=ai%20agents&minOutlier=5&since=30d&limit=2&fields=videoId,title,outlierScore,relevance&count=true'
```

```json
{
  "data": [
    { "videoId": "OISbyYot3Zo", "title": "LFM2.5: A 24B AI Agent Built for Your Laptop (The Real Math)", "outlierScore": 11.75, "relevance": 18.6552 },
    { "videoId": "RQi7x-navxU", "title": "Building the Document Context Layer for AI Agents — Jerry Liu, LlamaIndex", "outlierScore": 5.51, "relevance": 17.1363 }
  ],
  "nextCursor": "eyJ2IjoxLCJoIjoiM2J2aGRrM2pnX2dHRHFNVyIs…",
  "hasMore": true,
  "total": 4,
  "sort": "relevance",
  "mode": "topic"
}
```

```bash
# Filters only: Finance or Health bangers with the Curiosity trigger, biggest channels first
curl -s 'http://localhost:3210/api/v1/videos?niche=Finance,Health&trigger=Curiosity&tier=bangers,mega_bangers&sort=subscribers&limit=20'

# Keyword search sorted by views, as CSV (paging info in headers)
curl -s -D - 'http://localhost:3210/api/v1/videos?q=claude%20code&mode=keyword&sort=views&format=csv&limit=100'
#   X-Next-Cursor: eyJ2…   X-Has-More: true   (X-Total-Count with count=true)

# One channel's Shorts, JSONL
curl -s 'http://localhost:3210/api/v1/videos?channelId=@kurzgesagt&shorts=only&format=jsonl'
```

With `format=jsonl|csv` the body is just this page's rows (CSV has a header row; lists joined with `|`). Use `/api/v1/export` to get everything in one download.

### GET /api/v1/videos/{videoId}

A YouTube video id, a URL-encoded watch/shorts/youtu.be URL, or a library row id.

```bash
curl -s http://localhost:3210/api/v1/videos/mtiOK2QG9Q0 | jq .data.title
curl -s "http://localhost:3210/api/v1/videos/$(jq -rn --arg u 'https://youtu.be/mtiOK2QG9Q0' '$u|@uri')"
curl -s -w '%{http_code}\n' http://localhost:3210/api/v1/videos/doesnotexist   # 404 {"error":{"code":"not_found",…}}
```

### GET /api/v1/channels

| Parameter | Meaning |
|---|---|
| `q` | Matches channel names and handles (case, spaces and punctuation ignored) |
| `sort` | `videos` (default: most videos in the library), `subscribers`, `outlier` (best video), `avgOutlier`, `views` (total), `latest`, `name` (A–Z) |
| `tracked` | `true`: only channels added to the library (followed by the refresh pipeline) |
| `limit`, `cursor` | As for videos (limit default 50, max 1000) |

```bash
curl -s 'http://localhost:3210/api/v1/channels?q=engineer&sort=subscribers&limit=2'
```

```json
{
  "data": [
    { "channelId": "UClqhvGmHcvWL9w3R48t9QXQ", "channelName": "Engineering Explained", "handle": null,
      "channelUrl": "https://www.youtube.com/channel/UClqhvGmHcvWL9w3R48t9QXQ", "avatar": null, "subscriberCount": 4220000,
      "videoCount": 13, "totalViews": 32659792, "avgOutlierScore": 3.70, "maxOutlierScore": 7.26,
      "latestPublishAt": "2025-12-05T15:00:03.000Z", "tracked": false, "addedAt": null, "lastSyncedAt": null, "lastError": null }
  ],
  "nextCursor": "eyJ2…", "hasMore": true, "total": 8, "sort": "subscribers"
}
```

### GET /api/v1/channels/{channelId}

A `UC…` id, `@handle`, URL-encoded channel URL, or name. `?videos=N` (0–100, default 10) top videos by outlier score.

```bash
curl -s 'http://localhost:3210/api/v1/channels/@IBMTechnology?videos=3' | jq '.data | {channel: .channel.channelName, matchedBy, breakdown: .breakdown.byTier, top: [.topVideos[].title]}'
curl -s 'http://localhost:3210/api/v1/channels/AI%20Engineer'
```

`data` is `{channel, matchedBy: "id"|"handle"|"name", breakdown: {byTier, medianOutlierScore, topNiches, topTriggers, titleFormats, firstPublishAt}, topVideos}`. An ambiguous name is a 400 `ambiguous_channel` with `details.candidates`; no match is a 404.

### GET /api/v1/stats

```bash
curl -s http://localhost:3210/api/v1/stats | jq '.data | {totals, lastRefreshAt, refresh}'
```

`data` has `totals` (`videos, channels, trackedChannels, shorts, longform, publishedLast7Days, publishedLast30Days`), `dateRange`, `byTier`, `unscored`, `bySource`, `byTitleFormat`, `byNiche` and `byTrigger` (with `inTaxonomy` flags; the export has a few values outside the official lists), `builtAt` (last bulk rebuild), `lastRefreshAt` (last finished refresh run), `refresh` (latest run summary) and the raw `meta` table. Cached per library state for up to a minute.

### GET /api/v1/taxonomy

```bash
curl -s http://localhost:3210/api/v1/taxonomy | jq '.data | {tiers: [.tiers[].id], formats: .titleFormats, triggers: (.clickTriggers | length), niches: (.niches | length)}'
```

`tiers` (id, label, scoreLabel, min, max), `clickTriggers` (48), `niches` (45), `titleFormats` (name, frame, description), `povs`, `searchModes`, `sorts`.

### GET /api/v1/export

Every video matching the filters as one streamed download: `format=jsonl` (default, `application/x-ndjson`) or `format=csv` (`text/csv`), with `Content-Disposition: attachment; filename="hooklab-videos-<date>.<ext>"` and `X-Total-Count`. Takes every `/videos` filter plus `sort`, `fields` and `cursor` (resume); `limit` caps the total row count. Pages are read one at a time (backpressure-aware), so the library is never locked for the whole transfer and a rebuild swapping the file mid-way is picked up.

```bash
curl -s -OJ 'http://localhost:3210/api/v1/export?format=csv'                                  # whole library: ~300K rows, ~3 s
curl -s 'http://localhost:3210/api/v1/export?since=7d&minOutlier=2' > week.jsonl
curl -s 'http://localhost:3210/api/v1/export?format=csv&tier=mega_bangers&fields=videoId,title,views,outlierScore' > mega.csv
```

### POST /api/v1/titles

Runs the chat title pipeline (route → load channel context → research outliers in the library → Claude writes angle cards) for a video idea. It creates a chat, so the answer is also in the app at `chatUrl`. About 40 seconds.

| Body field | Meaning |
|---|---|
| `idea` | Required. What the video is about |
| `channelId` | One of your channels (`user_channels.id` or its `UC…` id). Default: the active channel. An unknown id is a 400 listing your channels |
| `stream` | `true` relays the pipeline's Server-Sent Events instead of waiting |

```bash
curl -s -X POST http://localhost:3210/api/v1/titles \
  -H 'content-type: application/json' \
  -d '{"idea": "Budget travel in Japan for two weeks on $1,500"}' | jq '.data | {chatUrl, intent, credits, cards: [.angleCards[] | {name, isRecommended, titles: [.titles[].title]}]}'
```

```json
{
  "chatUrl": "http://localhost:3210/chat/eae60ac7-…",
  "intent": "titles",
  "credits": 7,
  "cards": [
    { "name": "The $1,500 Price Breakdown", "isRecommended": true,
      "titles": ["How Cheap Can You Travel Japan? 2 Weeks on $1,500", "2 Weeks in Japan on a $1,500 Budget 🇯🇵 Full Cost Breakdown"] },
    { "name": "Copy-Paste Budget Itinerary", "isRecommended": false,
      "titles": ["How to Spend 14 Days in JAPAN on $1,500 (Budget Itinerary)", "Your FIRST 2 Weeks in Japan on $1,500 - 2026 Budget Guide"] }
  ]
}
```

The full `data`: `chatId, chatUrl, messageId, generationId, intent, topic, summary, angleCards[] ({id, name, emoji, description, titles[] ({id, title, angle, angleEmoji, clickTrigger, derivation, inspirationSources[]}), isRecommended, recommendationReason?}), bodyMarkdown, markdown (set instead of cards when the request was answered in prose), suggestedFollowups, videoMap (the library videos the titles were modeled on), provider, model, credits, durationMs`.

Streaming (`"stream": true`): `text/event-stream`, one `data: <json>` per event, each with `"version":"1.0"`; `: ping` comments keep the connection alive. The first event is `{"chat": {"id", "url", "messageId", "generationId"}}` (also in the `X-Chat-Id` header), then the pipeline's own events (see `docs/CHAT.md` §4): progress `{"tool_status":"executing","tool_name":"_routing"|"_loading_context"|"_deep_research"|"_generating"}`, `{"title": …}` per title, `{"card": …}` per angle, `{"chat_title": …}`, `{"error", "code"}` on failure, and finally `{"done": true, "canonical": {"type":"cards","payload":{"angleCards", "bodyMarkdown"}, "summary", "suggestedFollowups"}, "metadata", "videoMap", "credits"}`.

```bash
curl -sN -X POST http://localhost:3210/api/v1/titles -H 'content-type: application/json' \
  -d '{"idea": "home espresso for beginners", "stream": true}'
```

Closing the stream doesn't stop the generation: it finishes and is saved to the chat. Failures return 502 (provider/output errors), 429 (rate limit) or 503 (no provider) with `{error, chatId, chatUrl}`.

### Refresh pipeline

Owned by the live-outliers pipeline (`app/src/lib/core/ingest/`); listed here for completeness.

```bash
curl -s -X POST http://localhost:3210/api/v1/refresh -H 'content-type: application/json' -d '{"channels": 200, "discover": false}'
#   202 {"run": {"id": 3, "status": "running", …}, "status": "/api/v1/refresh/status"}; 409 refresh_running while another run holds the lock
curl -s http://localhost:3210/api/v1/refresh/status | jq '{running, lastRun: .lastRun.status, nextRunAt, totals}'
curl -s 'http://localhost:3210/api/v1/refresh/runs?limit=5' | jq '.runs[] | {id, status, newVideos, newOutliers}'
curl -s http://localhost:3210/api/v1/refresh/freshness      # no API key needed
```

`POST /refresh` body: `channels` (0–5000), `channelIds` (`UC…` list), `concurrency` (1–16), `discover`, `discoverQueries` (1–20), `tagging` (`outliers|all|off`), `dryRun`.

### Library channels

```bash
curl -s http://localhost:3210/api/v1/library/channels | jq '.channels[] | {name, handle, videos, outliers}'
curl -s -X POST http://localhost:3210/api/v1/library/channels -H 'content-type: application/json' -d '{"channel": "@kurzgesagt"}'
#   201 {"channel": {…}, "created": true, "backfill": {"videos": 45, …}}  (200 when it was already there)
curl -s http://localhost:3210/api/v1/library/channels/UCsXVk37bltHxD1rDPwtNM8Q
curl -s -X DELETE 'http://localhost:3210/api/v1/library/channels/UCsXVk37bltHxD1rDPwtNM8Q'           # stop tracking
curl -s -X DELETE 'http://localhost:3210/api/v1/library/channels/UCsXVk37bltHxD1rDPwtNM8Q?purge=1'   # also delete its pipeline rows
```

## Video object

| Field | Type | Notes |
|---|---|---|
| `id` | string | Library row id (Creator Hooks id, or `rss:<videoId>` for rows the pipeline added) |
| `videoId` | string | YouTube id |
| `title`, `titleLength` | string, integer | |
| `videoUrl`, `thumbnail` | string | |
| `channelId`, `channelName`, `subscriberCount` | string, string, integer | |
| `views` | integer | |
| `outlierScore`, `tier` | number, string | Tier from the score (see `/taxonomy`) |
| `publishAt` | string | ISO timestamp |
| `duration`, `durationSeconds`, `isShort` | string (ISO 8601), integer, boolean | |
| `frame`, `secondaryFrame`, `titleFormat` | string | `titleFormat` is the Outliers filter name for the frame |
| `pov` | string | e.g. `second_person_direct` |
| `niches`, `clickTriggers`, `videoTypes` | string[] | |
| `featuredInNewsletter` | boolean | |
| `source` | string | `export` or `rss` |
| `relevance` | number | Topic searches only |

This is the original `/api/outliers/videos` row shape (`toOutlierVideo`) without the per-user `isBookmarked`/`bookmarkTags`/`projectIds`, plus `tier`, `titleFormat`, `source` and `relevance`.

## Notes

- **Speed.** On the ~300K-row library, a sweep of 230 filter × sort × page-size (50 and 1000) combinations measured a median of 6 ms, 90% under 51 ms and a worst case of 113 ms (page queries; `count=true` adds a full count, up to ~100 ms on broad filters). A whole-library export streams at ~100K rows/s. Each query walks exactly one index: the sort's own index by default, or a far more selective filter's (a channel, a small niche or trigger, Shorts only, a narrow date or score range) when the expected walk would be longer; other indexable predicates are written as `+column` so SQLite can't pick a worse plan. Topic relevance is computed from frozen statistics so it can page by keyset. Three indexes were appended to the library schema for this (`videos_subscribers_sort` on `coalesce(subscriber_count, -1)`, `videos_source`, and the partial `videos_shorts`); the expression and partial forms leave existing queries' plans unchanged.
- **Concurrency.** The library is in rollback-journal mode, so readers briefly wait (busy timeout 5 s) while the refresh pipeline commits instead of failing.
- **Not covered.** The Outliers page's "Title Formula" and "Thumbnail" search modes aren't in the API (they need the app's formula index / image embeddings). Per-user data (bookmarks, projects, follows) stays in the app's own routes.
