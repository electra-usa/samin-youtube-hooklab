# Live outliers pipeline

HookLab's own replacement for Creator Hooks' library updates. It polls channels for new uploads, keeps view counts fresh, scores outliers with the same rule Creator Hooks uses, tags new outliers with Claude, discovers channels the library lacks, and runs on a schedule. It works against `data/library.db` next to the exported library and doesn't depend on Creator Hooks at all.

Code: `app/src/lib/core/ingest/` (framework-free, so the Next.js server, the `hooklab` CLI and the worker container share it). Entry points: `hooklab refresh | discover | library`, `POST /api/v1/refresh` and friends, and `app/src/instrumentation.ts`.

- [How a run works](#how-a-run-works) · [Sources and costs](#sources-and-costs) · [Scoring](#scoring) · [Tagging](#tagging) · [Discovery](#discovery) · [Library channels](#library-channels) · [Scheduling](#scheduling) · [Settings](#settings) · [Data model](#data-model) · [Rebuilds and the export](#rebuilds-and-the-export) · [Verification](#verification) · [Limits and known gaps](#limits-and-known-gaps)

## How a run works

1. **Lock.** `data/refresh.lock` (exclusive create, 30-second heartbeat, stale after 10 minutes or when its process is gone) keeps the CLI, the worker, the API and the in-process scheduler from overlapping. A second run gets `RefreshBusyError` (CLI exit code 3, API 409).
2. **Pick channels.** Candidates are every channel in `channels` (the export's ~8.4K) plus `library_channels` (added by you or discovery). Each gets a polling interval from how recently it uploaded: 4 h if it uploaded in the last 3 days, 8 h within 14 days, 24 h within 45 days, 72 h within 180 days, else weekly. User-added channels poll 3x as often (at least hourly), discovered ones 2x, channels with a 10x+ video 25% more often; errors back off exponentially (up to 14 days). A run takes the `--channels N` most overdue (`(now - last poll) / interval`). Never-polled channels are due at once, user-added first, then by recent activity.
3. **Fetch feeds.** For each channel, the long-form uploads feed (`UULF…`) and, if the channel posts Shorts, the Shorts feed (`UUSH…`), 6 channels at a time with retries and a shared back-off on HTTP 429 (four 429s in a row end the polling phase early).
4. **Apply** in short batches (25 channels or 5 seconds per transaction): insert new videos as `rss:<videoId>`, refresh views and scores on existing rows (which become `source='rss'`), keep `videos_fts`, `video_niches`/`video_click_triggers` and the channel's `channels` row in step, and record per-channel state.
5. **Enrich** new long-form outliers with durations (see costs below).
6. **Tag** new outliers with Claude.
7. **Discover** new channels when asked (`--discover`, or `HOOKLAB_DISCOVER=on` every `HOOKLAB_DISCOVER_EVERY_HOURS`); kept channels are polled in the same run.
8. **Log** the run in `refresh_runs` (counts, credits, Claude cost, the first 20 errors) and stamp `ingest_state.last_refresh_at` and `meta.last_refresh_at`.

Typical numbers (measured 2026-10-18): 200 channels took 137 s: about 40 s of polling (420 feed requests), the rest durations and three tagging batches. It found 2,758 new videos, refreshed 1,837 and counted 98 new outliers. The first poll of a channel stores its latest ~15 long-form and ~15 Shorts uploads. Later polls only add what's new.

## Sources and costs

| Source | Used for | Cost |
|---|---|---|
| YouTube RSS, typed uploads playlists: `feeds/videos.xml?playlist_id=UULF<id>` (long-form, without Shorts or live streams) and `UUSH<id>` (Shorts) | New uploads, exact view counts, exact publish times, titles. The channel feed (`channel_id=`) is only a fallback when a channel has no long-form playlist. | Free, no key. YouTube caches each feed for 15 minutes (`Cache-Control: max-age=900`) and sends no ETag or Last-Modified, so conditional requests aren't possible. ~1.6 requests per channel per poll. |
| ScrapeCreators `channel-videos` | Durations for new long-form outliers. One call returns a channel's latest ~30 uploads with lengths, so it also fills the channel's other rows. | 1 credit per channel, at most `HOOKLAB_ENRICH_MAX_CALLS` (15) per run. |
| ScrapeCreators `search` | Discovery | 1 credit per query |
| ScrapeCreators `channel` | Subscriber counts for channels the library doesn't know (discovery, `library add` fallback) | 0 credits when cached (`cache_max_age=7d`/`30d`), else 1 |
| Public channel page, oEmbed, watch page | `library add` resolution (handle → `UC…` id, name, avatar, subscribers), exact publish times for backfilled videos, and durations once the credit budget is spent (`HOOKLAB_ENRICH_MAX_PAGES`, 20 per run) | Free, best effort |
| Claude (`claude-opus-5-5`, effort low) | Tagging | About $0.07 per 40-title batch through the Anthropic SDK or the signed-in Claude Code CLI |

**Credit budget.** Every paid call goes into `scrapecreators_calls`. The pipeline won't spend more than `SCRAPECREATORS_DAILY_CREDITS` (default 100) in any rolling 24 hours, and it stops if the last `credits_remaining` it saw reaches 0. HTTP 401, 402 or 403 pauses ScrapeCreators for 30 minutes. The key comes from `SCRAPECREATORS_API_KEY` and is never logged. `hooklab refresh status` and `GET /api/v1/refresh/status` show credits used in the last 24 hours and the account's remaining credits.

## Scoring

The rule is the one reverse-engineered for My Channel (`app/src/lib/channel/outliers.ts`, imported as is). A video's score is its views divided by the rounded mean views of the up to 10 videos **of the same kind** (long-form or Shorts) that the channel published just before it. Tiers use the same bands as the library: flops < 0.3, below_avg < 1, pretty_good < 2, above_avg < 4, great < 10, bangers < 50, mega_bangers 50+.

This is Creator Hooks' library rule too. Recomputing exported videos from fresh feed data with it reproduces their stored scores: on channels whose export is complete, window baselines match to about 1% (median ours/theirs 1.006 over the first 100 refreshed export rows; Kurzgesagt's three 2x+ videos within 0.1–6%; the gaps come from views that grew since the export).

**The comparison window** is the channel's history in the library: every video the pipeline has seen in a feed, plus export rows. Feeds list every upload, so observed history has no gaps. The export went out by tier (2x+ first), so for channels where the export so far is mostly outliers (fewer than 30% of their export rows below 2x), unobserved export rows are left out of the window rather than inflating it. Two guards:

- An **exported video** keeps Creator Hooks' own baseline (views ÷ score from the export row) when our window is shorter than 10 videos, because their window was complete. As its views grow, its score grows with them.
- A **pipeline-inserted video** needs at least 3 earlier videos to compare with (`MIN_COMPARED`). Otherwise its score stays empty: a truncated window of one or two old videos is noise.

Views and scores refresh every time a channel's feeds are polled, so a video's score moves as it gains views. A **new outlier** is a video that first reaches 2x while the pipeline watches it and was published within the last 30 days. Older videos crossing 2x on first sight (a channel's back catalog during its first poll) aren't counted as news. That number drives `newOutliers24h` and the Outliers page's "N new outliers today". The run's top-outliers list uses the same rule.

## Tagging

New videos the pipeline inserted get the library's labels from Claude: one niche (of the 45), 1–4 click triggers (of the 48, stored sorted), a frame (analysis, tutorial, story, list, experiment, review, reaction) and a point of view (the 5 in the taxonomy). Requests go through the chat's providers: the Anthropic SDK when `ANTHROPIC_API_KEY` (or an `ant` profile) exists, else the local Claude Code CLI. The system prompt carries the taxonomy with short definitions and 24 fixed examples from the export, so it's identical on every call and can be prompt-cached. Each title comes with its channel's usual niches when the library knows them. Batches of 40, at most 3 per run (`HOOKLAB_TAGGING_MAX_BATCHES`). A video is tried 3 times at most. `HOOKLAB_TAGGING=outliers` (default) tags videos at 2x+, `all` tags every new video, `off` disables tagging. Rows that already have export tags are never retagged.

## Discovery

`hooklab discover [--queries N]` (or `--discover` on a refresh) runs N search queries. They rotate: your active channel's topics and primary niches from `data/app.db` (`channel_profiles`) come back daily, and two phrases per library niche (90 in all) come back weekly. Each query is ScrapeCreators search for this week's most popular videos. A candidate is a channel not already in the library with a video of at least `HOOKLAB_DISCOVER_MIN_VIEWS` (20K) views; the 6 best per query are checked:

1. **Language.** When your content language is only English (`settings.contentLanguages`), the channel's own recent upload titles (free RSS) must be at least 70% Latin script. One English title in the search results isn't enough; the first test run let through Hindi and Korean channels that way.
2. **Size.** Subscriber count comes from ScrapeCreators (30-day cache, usually free), else the public channel page. The channel is kept when its video has at least `HOOKLAB_DISCOVER_MIN_RATIO` (1.0) views per subscriber, with at least 1,000 subscribers.

Kept channels go into `library_channels` and get discovered-channel priority. Every check is remembered in `discovered_channels` (`added`, `rejected`, `language`), so a channel isn't re-checked for 30 days. Cost: about 1 credit per query plus 0–6 lookups.

## Library channels

```bash
hooklab library add @veritasium                  # or a channel URL, a video URL, or a UC… id
hooklab library add https://youtube.com/@mkbhd --shallow
hooklab library list
hooklab library sync UCHnyfMqiRRG1u-2MsSQLbXA [--deep]
hooklab library remove UCHnyfMqiRRG1u-2MsSQLbXA [--purge]
```

`add` resolves the channel for free first (the public channel page; oEmbed for video URLs; RSS for `UC…` ids) and falls back to ScrapeCreators `channel?handle=` when that fails. It then backfills: the RSS feeds plus one ScrapeCreators `channel-videos` page (~30 uploads with exact views and lengths, 1 credit; `--shallow` skips it). That listing only has relative times ("1 year ago"), so exact times come from each listing-only video's watch page (free, up to 20). Anything still approximate is marked `publishAtApprox` in `raw`. `remove` deletes the channel from `library_channels` and pauses its polling, which also works for channels that came with the export. `--purge` also deletes the `rss:` rows the pipeline stored for it. The same operations are on the API: `GET/POST /api/v1/library/channels`, `GET/DELETE /api/v1/library/channels/{channelId}` (see `docs/API.md`).

## Scheduling

Three ways to run it, all sharing the lock:

| Where | How | When to use |
|---|---|---|
| Worker process | `hooklab refresh --loop --every 60` (the `worker` service in `docker-compose.yml`) | Hosting: keeps polling apart from web traffic |
| Inside the Next.js server | `HOOKLAB_REFRESH_EVERY_MINUTES=60` in the server's env (`app/src/instrumentation.ts`; never during `next build`; first run 30 s after boot, `HOOKLAB_REFRESH_FIRST_DELAY_SECONDS`) | One-process hosts (Railway, a Mac mini running `next start`) |
| Cron | `curl -X POST $HOST/api/v1/refresh -H "Authorization: Bearer $HOOKLAB_API_KEY" -d '{"channels":300}'` | Platforms with a scheduler but no always-on worker. 409 means a run is still going; just skip. |

Intervals are measured from each run's start, and a run that overlaps the next tick makes that tick skip. The loop writes its next run time to `ingest_state`, so `GET /api/v1/refresh/status` shows `nextRunAt` and the scheduler's owner (worker or scheduler) from any process that shares the data directory.

**Capacity.** 300 channels per hourly run is 7,200 polls a day. With ~8.4K export channels, the first full sweep takes about 28 hours. After that the rotation spends its polls on active channels first (a channel that uploads daily wants about 6 polls a day). Raise `--channels` or shorten the interval if `channelsPolled24h` stays well below the number of active channels. At 6 parallel requests a 300-channel poll takes about a minute.

## Settings

All environment variables (`app/.env.local` locally, `.env` / platform secrets when hosted):

| Variable | Default | Meaning |
|---|---|---|
| `HOOKLAB_REFRESH_EVERY_MINUTES` | off | In-process scheduler interval (Next.js server) |
| `HOOKLAB_REFRESH_FIRST_DELAY_SECONDS` | 30 | Delay before the in-process scheduler's first run |
| `HOOKLAB_REFRESH_CHANNELS` | 300 | Channels per run |
| `HOOKLAB_REFRESH_CONCURRENCY` | 6 | Parallel feed requests (max 16) |
| `HOOKLAB_SHORTS` | on | Track Shorts through each channel's `UUSH` feed |
| `HOOKLAB_DISCOVER` | off | Discovery inside scheduled runs |
| `HOOKLAB_DISCOVER_EVERY_HOURS` | 6 | Minimum gap between scheduled discoveries |
| `HOOKLAB_DISCOVER_QUERIES` | 3 | Queries per discovery |
| `HOOKLAB_DISCOVER_MIN_RATIO` | 1 | Views per subscriber a discovered channel's video needs |
| `HOOKLAB_DISCOVER_MIN_VIEWS` | 20000 | Minimum views for a discovery candidate's video |
| `HOOKLAB_TAGGING` | outliers | `outliers` (2x+), `all`, `off` |
| `HOOKLAB_TAGGING_MODEL` | claude-opus-5-5 | Tagging model |
| `HOOKLAB_TAGGING_BATCH` / `HOOKLAB_TAGGING_MAX_BATCHES` | 40 / 3 | Titles per request / requests per run |
| `SCRAPECREATORS_API_KEY` | none | Enables durations, discovery and lookups |
| `SCRAPECREATORS_DAILY_CREDITS` | 100 | Rolling 24-hour credit budget |
| `HOOKLAB_ENRICH_MAX_CALLS` / `HOOKLAB_ENRICH_MAX_PAGES` | 15 / 20 | Duration lookups per run: paid / free watch pages |
| `ANTHROPIC_API_KEY`, `HOOKLAB_AI_PROVIDER`, `HOOKLAB_CLAUDE_CLI` | none | Claude provider (same as the chat, see `docs/CHAT.md`) |
| `HOOKLAB_DATA_DIR` | repo `data/` | Where `library.db`, `app.db` and `refresh.lock` live |

## Data model

New tables, appended to `app/src/lib/core/library-schema.ts` and created on first open:

| Table | Holds |
|---|---|
| `channel_poll_state` | Per channel: last poll and success, newest upload seen, Shorts flag and check time, consecutive errors, last error, paused, poll count |
| `live_videos` | Every video the pipeline has seen: row id, origin (`new` = inserted by the pipeline, `export` = refreshed export row), first seen, last checked, window baseline and size, `outlier_at` (first time at 2x+), enrichment and tagging state |
| `refresh_runs` | One row per run: trigger (cli, worker, api, scheduler), status (running, ok, partial, failed, aborted, dry_run), counts, credits, Claude cost, error sample, options |
| `scrapecreators_calls` | The credit ledger |
| `discovery_queries`, `discovered_channels` | Discovery rotation and verdicts |
| `ingest_state` | `last_refresh_at`, `last_discovery_at`, the loop's schedule |

Videos the pipeline inserts get id `rss:<videoId>`, `source='rss'`, a thumbnail at `i.ytimg.com/vi/<id>/hqdefault.jpg`, a `/shorts/` URL for Shorts, the channel's known subscriber count, and a small `raw` snapshot (first-seen time and views). The Outliers page marks uploads from the last 24 hours that the pipeline found with a "New upload" pill, and shows "Library updated … · N new outliers today" under the title (`GET /api/v1/refresh/freshness`, readable without the API key).

## Rebuilds and the export

While the Creator Hooks export is still running, `scripts/private/build-db.py` rebuilds `data/library.db` every 15 minutes and swaps the file atomically. It keeps rows whose `source` isn't `export`, `library_channels`, and every extra table and its indexes; `meta` is rebuilt (`ingest_state` keeps `last_refresh_at`). The pipeline works with that:

- **Short transactions, fresh handle per batch.** A swap can't strand a whole run on the old file.
- **Replay.** A write made while a rebuild is in progress (its `library.db.tmp-*` file exists) may miss the rebuild's copy. Those writes are journaled in memory and replayed once the swap is seen (inode change), or when the run ends after waiting up to 2 minutes for the rebuild. Every write is an idempotent upsert.
- **Merging duplicates.** When the export later delivers a video the pipeline inserted first, the rebuild has two rows for it. Each run starts by folding the `rss:` row into the export row: it keeps the export id (what bookmarks reference), the higher view count, and the export's tags if it has them. The merged row stays `source='rss'`.

Readers wait up to 5 seconds for a commit (busy timeout) instead of failing, because the library uses a rollback journal. WAL mode isn't an option while the file is being swapped underneath.

## Verification

Done on 2026-10-18 against the real library (~297K videos):

- `hooklab refresh --channels 200` polled 200 channels (420 requests) and stored 2,758 new videos, refreshed 1,837, counted 98 new outliers, filled 176 durations (15 credits plus 20 watch pages), tagged 120 videos (~$0.22). No errors.
- Spot-check against YouTube on six new long-form outliers (an independent script that read each channel's `UULF` feed and each video's watch page): stored views equal the watch page's `viewCount` in five of six (one was 21 views behind because of RSS's 15-minute cache). Every score whose 10-video window fits in the feed matches an independent recompute exactly (35.52x, 13.40x, 6.55x). Windows that reach past the feed use older library rows, as the rule intends.
- Discovery (2 queries) added 4 channels for 6 credits. Two turned out not to be English, which led to the language check above; they were removed with `library remove --purge`. `library add @kurzgesagt` resolved through the free channel page and backfilled 45 uploads with exact times. `library add @veritasium --shallow` worked in the Docker image.
- API: `POST /api/v1/refresh` → 202 with the run, a second POST → 409 `refresh_running`, bad bodies → 400. The status, runs, freshness and library endpoints were checked with curl.
- Scheduler: the loop ran twice 60 s apart when invoked directly. `next start` with `HOOKLAB_REFRESH_EVERY_MINUTES=1` started it from `instrumentation.ts` and it ran. A CLI run that overlapped its next tick made the tick skip ("A refresh is already running (run 10 … by cli)").
- Rebuilds: the background rebuild that swapped the file during testing kept every pipeline row. The first run afterwards merged the two duplicate rows it had created (the export had caught up with two videos the pipeline found first). A manual `python3 -I scripts/private/build-db.py` left every count unchanged: 300,566 videos, 6,655 `source='rss'` rows (3,990 inserted by the pipeline, all in `videos_fts`), their 160 niche and 387 trigger rows, 6,655 `live_videos`, 294 `channel_poll_state`, 10 `refresh_runs`, 43 ledger rows, 90 discovery queries, 12 discovered channels, 3 `library_channels`, and the pipeline's 6 indexes. Only `meta.built_at` changed.

## Limits and known gaps

- **RSS caps a feed at the latest 15 entries per kind.** A channel that uploads more than 15 videos between polls has gaps in its observed history. Daily uploaders are polled every 4 hours, so this is rare.
- **Scores of the oldest entries on a channel's first poll** lean on export rows (or Creator Hooks' baseline) when the feed can't fill a 10-video window, and stay empty below 3 comparisons.
- **The first sweep** of all ~8.4K export channels stores up to ~30 recent videos per channel, roughly 200K rows. That's a lot of 1x-ish videos, which the default 2x+ filter hides.
- **Durations** are filled for long-form outliers only (Shorts don't need them for the UI). Untagged or unenriched rows wait for later runs when a run's caps are reached.
- **Live streams** are excluded: the `UULF` playlist leaves them out, as Creator Hooks' long-form library appears to.
- **Discovery's language check** is a script heuristic for English-only users. Other content languages skip it.
- **Language and region of ScrapeCreators search** aren't configurable (results skew to wherever their crawler sits).
- **No ETag/conditional requests**: YouTube's feeds don't support them. The 15-minute server cache is the floor for useful polling.
