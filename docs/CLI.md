# `hooklab` CLI

`hooklab` pulls the outlier library from the terminal: search and filter videos, look up videos and channels, read stats and taxonomies, stream full exports as CSV or JSONL, generate titles, and start the app. It reads `data/library.db` directly through the same query code as the REST API (`app/src/lib/core/query/`), so the CLI and `/api/v1` always return the same rows. Only `titles` needs a running server.

The CLI and the API are HookLab additions; the original Creator Hooks had neither.

- [Install](#install) · [Output and exit codes](#output-and-exit-codes) · [Commands](#commands) · [Search semantics](#search-semantics) · [Recipes](#recipes) · [Adding a command](#adding-a-command)

## Install

Needs Node.js 24 (it runs the TypeScript sources directly, so there is no build step) and an installed app (`cd app && npm install`).

```bash
cd cli && npm link            # or, from the repo root: npm install -g ./cli
hooklab --version
hooklab help

npm unlink -g hooklab-cli     # remove it again
```

Without installing: `node cli/bin/hooklab.mjs <command>`.

### Configuration

On start the CLI loads `app/.env.local`, then the repo's `.env` (variables already set in your shell win, and the first file wins over the second).

| Variable | Used for |
|---|---|
| `HOOKLAB_URL` | Server for `titles` (default `http://localhost:3210`) |
| `HOOKLAB_API_KEY` | Sent as `Authorization: Bearer …` when the server requires a key |
| `HOOKLAB_DATA_DIR` | Folder with `library.db` and `app.db` (default: the repo's `data/`) |
| `LIBRARY_DB_PATH` | Path to the library file itself |
| `NO_COLOR` / `HOOKLAB_NO_COLOR` | Plain output without ANSI colors |
| `HOOKLAB_DEBUG` | Print stack traces on errors |
| `COLUMNS` | Table width when stdout isn't a terminal (default 200) |

## Output and exit codes

Every command takes the global flags anywhere on the line:

| Flag | Output |
|---|---|
| *(none)* | A table sized to the terminal; long titles are cut with `…` |
| `--json` | One JSON document. Lists come as `{data, nextCursor, hasMore, total?}` (same as the API) |
| `--jsonl` | One JSON object per line (`--ndjson` works too) |
| `--csv` | CSV with a header row; RFC 4180 quoting; lists (`niches`, `clickTriggers`, `videoTypes`) joined with `|` |
| `--help`, `-h` | Help for the command |

Results go to stdout; progress, counts and the next page's cursor go to stderr, so pipes and redirects only get data.

Exit codes: `0` success, `1` runtime error or nothing found (`video`, `channel`), `2` usage error (unknown flag, invalid filter value, bad cursor).

## Commands

| Command | What it does |
|---|---|
| [`stats`](#stats) | Library totals and breakdowns, last rebuild and refresh |
| [`search [query…]`](#search) | Search and filter videos |
| [`top [query…]`](#top) | Highest outlier scores, last 30 days by default |
| [`video <id\|url>`](#video) | One video |
| [`channels [query…]`](#channels) | List channels |
| [`channel <id\|@handle\|name>`](#channel) | One channel with breakdown and top videos |
| [`taxonomy [list]`](#taxonomy) | Triggers, niches, tiers, title formats with counts |
| [`export`](#export) | Stream every matching video to CSV or JSONL |
| [`titles "<idea>"`](#titles) | Generate titles through the running server |
| [`serve`](#serve) | Start the app |
| `refresh`, `discover`, `library` | The live outliers pipeline (see `hooklab help refresh` etc.) |
| `help [command]` | Overview, or one command's usage |

### stats

```bash
hooklab stats              # totals, date range, rebuild + last refresh, tier/format/niche/trigger/source tables
hooklab stats --all        # every niche and click trigger
hooklab stats --json | jq .totals
hooklab stats --csv        # one row per breakdown entry: section,key,label,count
```

```
HookLab library
Videos        296,720 (296,626 long-form, 94 Shorts)
Channels      8,384
Published     2007-05-11 → 2026-10-18 · 1,823 in the last 7 days · 13,875 in the last 30
Rebuilt       2026-10-18 21:23 UTC (5 minutes ago)
Last refresh  2026-10-18 21:21 UTC · ok · +144 videos · +12 outliers · 2 runs

TIER           RANGE      VIDEOS  SHARE
Mega Bangers   ≥ 50x       2,070   0.7%  ▋
Bangers        10x – 50x  12,786   4.3%  ████▏
…
```

### search

```
hooklab search [query…] [filters]
```

Searches titles. Without a query it lists every video matching the filters. Tables show 25 rows unless `--limit` is set; JSON/JSONL/CSV default to 50 (max 1000).

| Flag | Meaning |
|---|---|
| `--mode topic\|keyword` | `topic` (default): any stemmed term, ranked by relevance. `keyword`: every word must appear; `"quoted phrases"` stay together |
| `--min-outlier N`, `--max-outlier N` | Outlier score range, inclusive (`5` or `5x`) |
| `--tier ID` | `flops`, `below_avg`, `pretty_good`, `above_avg`, `great`, `bangers`, `mega_bangers` (labels like "Mega Bangers" work) |
| `--min-views N`, `--max-views N` | Views; accepts `100k`, `1.5M`, `25,000` |
| `--min-subs N`, `--max-subs N` | Channel subscribers |
| `--niche NAME` | Any of these niches |
| `--exclude-niche NAME` | None of these niches |
| `--trigger NAME` | Any of these click triggers |
| `--exclude-trigger NAME` | None of these click triggers |
| `--format-type NAME` | Title format: Challenge, Tutorial, Explainer, List, Story, Review, Reaction (or the frame: experiment, analysis…) |
| `--channel REF` | A channel: `UC…` id, `@handle`, channel URL or exact name |
| `--since WHEN`, `--until WHEN` | Publish date: `2026-09-30`, `2026-09`, `2026`, a timestamp, `today`, `yesterday`, or an age: `24h`, `7d`, `2w`, `3m`, `1y` |
| `--shorts include\|only\|exclude` | Default `include` |
| `--source NAME` | Row origin: `export` (the Creator Hooks export) or `rss` (added or refreshed by the live pipeline) |
| `--sort KEY` | `relevance` (default for topic searches), `newest` (default otherwise), `outlier`, `views`, `subscribers` |
| `--limit N` | Rows per page, 1–1000 |
| `--cursor C` | Continue from the cursor printed on stderr |
| `--fields a,b,c` | Pick output fields (see [Video fields](#video-fields)) |
| `--count` | Also print the number of matches |

`--tier`, `--niche`, `--exclude-niche`, `--trigger`, `--exclude-trigger`, `--format-type`, `--channel` and `--source` are repeatable and accept comma-separated values. Names match ignoring case and punctuation (`--niche marketing-business` finds "Marketing & Business").

```bash
hooklab search "ai agents" --min-outlier 5 --since 30d
hooklab search "claude code" --mode keyword --sort views --limit 10
hooklab search --niche Finance --tier bangers,mega_bangers --sort outlier
hooklab search "budget travel" --exclude-niche "News & Politics" --csv > travel.csv
hooklab search "ai agents" --fields videoId,title,outlierScore --jsonl | jq -r .title
```

```
$ hooklab search "ai agents" --min-outlier 5 --since 1y --limit 4 --count
OUTLIER  VIEWS  SUBS  PUBLISHED   CHANNEL            TITLE                                     VIDEO
   5.8x   206K  1.8M  2026-02-10  IBM Technology     Securing AI Agents with Zero Trust        d8d9EZHU7fw
   6.0x   362K  1.2M  2026-03-23  Teacher's Tech     Claude Code: Build Your First AI Agent    gHB4JFG9i3k
   5.2x    20K  424K  2026-05-07  Julian Goldie SEO  New OpenSwarm AI Agent is Insane (FREE!)  QreoZTA4YEA
  19.4x   574K  1.8M  2026-04-14  IBM Technology     The 7 Skills You Need to Build AI Agents  mtiOK2QG9Q0
103 matching videos (topic search, sorted by relevance)
next cursor: eyJ2IjoxLCJoIjoi…
```

Outlier scores are colored by tier in a terminal (Mega Bangers magenta, Bangers blue, Great green, Above Average yellow).

### top

`hooklab search --sort outlier --since 30d` with a shorter name and a 20-row table. Every search flag works; `--since all` covers the whole library.

```bash
hooklab top
hooklab top --since 7d --niche Technology --limit 10
hooklab top "productivity" --min-views 100k
hooklab top --since all --tier mega_bangers --json
```

### video

```bash
hooklab video mtiOK2QG9Q0
hooklab video "https://youtu.be/mtiOK2QG9Q0"      # watch, youtu.be, /shorts/, /embed/ links and row ids work
hooklab video mtiOK2QG9Q0 --json
```

```
The 7 Skills You Need to Build AI Agents
Channel      IBM Technology (UCKWaEZ-_VweaEx1j62do_vQ) · 1.8M subscribers
Outlier      19.4x · Bangers (10x – 50x)
Views        573,824
Published    2026-04-14 · 6 months ago
Duration     14:37
Format       Tutorial
Niches       Technology
Triggers     Desire, List
URL          https://www.youtube.com/watch?v=mtiOK2QG9Q0
…
```

### channels

```bash
hooklab channels                                   # most videos in the library first
hooklab channels engineer --sort subscribers       # name/handle search
hooklab channels --sort outlier --limit 10 --csv   # best single video
hooklab channels --tracked                         # channels added with `hooklab library add`
```

Sorts: `videos` (default), `subscribers`, `outlier` (best video), `avgOutlier`, `views` (total), `latest`, `name` (A–Z). Tables show 25 rows; the cursor for the next page goes to stderr.

### channel

```bash
hooklab channel UCLKPca3kwwd-B59HNr-_lvA
hooklab channel "AI Engineer" --videos 5
hooklab channel @kurzgesagt --json
```

Accepts a `UC…` id, `@handle`, channel URL or name (ignoring case, spaces and punctuation; a unique partial name works; an ambiguous one lists candidates and exits with 2). Shows subscribers, library coverage, total views, best/average/median outlier score, tier mix, top niches, triggers and title formats, tracking status, and the top videos by outlier score (`--videos N`, default 10). `--jsonl`/`--csv` print just the top videos.

### taxonomy

```bash
hooklab taxonomy                 # all four lists with video counts
hooklab taxonomy triggers        # the 48 click triggers
hooklab taxonomy niches --csv    # the 45 niches
hooklab taxonomy tiers           # score ranges
hooklab taxonomy formats         # title formats and the frame each maps to
```

### export

```
hooklab export --format jsonl|csv [--out FILE] [query…] [filters]
```

Streams **every** matching video (no row limit unless `--limit N`), page by page, so a full export works while the refresh pipeline keeps writing, and never holds the library locked. Progress goes to stderr (a live counter in a terminal). The format can also come from `--csv`/`--jsonl` or the `--out` extension (`.csv`, `.jsonl`, `.ndjson`). All search filters, `--sort`, `--fields` and `--cursor` work.

```bash
hooklab export --format csv --out library.csv                     # whole library (~300K rows, ~120 MB, ~3 s)
hooklab export --format jsonl --since 30d --min-outlier 3 > recent-outliers.jsonl
hooklab export --csv --tier bangers,mega_bangers --fields videoId,title,channelName,views,outlierScore --out bangers.csv
hooklab export "ai agents" --format jsonl | jq -r .title
```

```
Exporting 297,101 videos as CSV to /tmp/library.csv…
Exported 297,101 videos to /tmp/library.csv (121.5 MB) in 2.5s.
```

### titles

```
hooklab titles "<video idea>" [--channel ID] [--no-stream]
```

Generates titles with HookLab's chat pipeline (Claude, grounded in real outliers from the library) through the running server's `POST /api/v1/titles`. Takes about 40 seconds. Progress streams to stderr; the finished angle cards print to stdout. Every run is saved as a chat, so it also shows up in the app (the URL is printed). `--channel` picks one of your channels (user channel id or `UC…` id; default: the active one). `--json` prints the full result; `--jsonl`/`--csv` print one row per title (`angle, angleName, emoji, recommended, title, clickTrigger, inspiredBy, inspiredByChannel, chatUrl`).

```bash
hooklab titles "I automated my whole YouTube workflow with Claude Code agents"
hooklab titles "budget travel in Japan for 2 weeks" --json > titles.json
hooklab titles "the best free AI tools for students" --csv
```

```
Chat: http://localhost:3210/chat/3d203fc2-…
  ✓ 🛑 Quit Doing It Manually (25s)
  ✓ 🤖 My Build Story (27s)
  …
1. 🛑 Quit Doing It Manually  ★ recommended
   Tells creators that doing every YouTube task by hand is the old way, and shows them how to get out of it.
   • DON'T Run YouTube Manually, Build Claude Code Agents! (Full Workflow)  [Warning + Escape]
     ↳ modeled on "DON'T Build n8n workflows, build Agentic Workflows! (Claude Code)" — Samin Yasar
   …
10 titles in 5 angles · 36s · 9 credits · claude-opus-5-5
```

If the server isn't running: `Can't reach HookLab at http://localhost:3210 (ECONNREFUSED). Start it with hooklab serve, or set HOOKLAB_URL.` (exit 1).

### serve

```bash
hooklab serve                    # npm run start if app/.next has a production build, else npm run dev; port 3210
hooklab serve --port 4000 --dev
hooklab serve --prod             # require the production build (cd app && npm run build)
```

Refuses to start when the port is already taken (HookLab is probably running there). Ctrl+C stops the server.

## Search semantics

- **Topic** (default) splits the query into words, drops stopwords, and matches any of them (stemmed by SQLite FTS5's porter tokenizer, so "agents" finds "agent"). Each match is scored with BM25-style weights: rarer words count more, shorter titles rank higher, and titles containing the whole phrase get a bonus. A video needs at least half of the query's total word weight, or the whole phrase, to count as a match, so one common word ("online", "how") isn't enough. Sorted by that relevance unless `--sort` says otherwise; `--sort outlier` then ranks the topic's matches by outlier score.
- **Keyword** requires every word (`"exact phrase"` in quotes stays a phrase). Sorted newest first by default.
- Searches look at titles only. Use `--channel` for a channel.
- `--niche` / `--trigger` match videos with **any** of the given values; excludes drop videos with any of theirs. Several `--tier` values combine into one set of score ranges, and `--min-outlier`/`--max-outlier` narrow that further.
- Sorting is always descending; ties break on the row id.

### Pagination

Pages are keyset-based: the cursor holds the last row's sort key and id, plus values fixed on the first page (resolved `--since 7d` bounds, topic weights). Walking a listing with `--cursor` never returns duplicates, even while the refresh pipeline inserts videos, and a cursor only works with the filters it came from (exit 2 otherwise). Rows whose sort value changes mid-walk (e.g. views refreshed by the pipeline while you page `--sort views`) can move across the cursor.

```bash
cursor=""
while :; do
  if [ -n "$cursor" ]; then set -- --cursor "$cursor"; else set --; fi
  hooklab search --tier mega_bangers --limit 200 --jsonl "$@" >> mega.jsonl 2>/tmp/hl-err || break
  cursor=$(sed -n 's/^next cursor: //p' /tmp/hl-err)
  [ -z "$cursor" ] && break
done
```

(`hooklab export` does this for you.)

### Video fields

`id, videoId, title, titleLength, videoUrl, thumbnail, channelId, channelName, subscriberCount, views, outlierScore, tier, publishAt, duration, durationSeconds, isShort, frame, secondaryFrame, titleFormat, pov, niches, clickTriggers, videoTypes, featuredInNewsletter, source`, plus `relevance` on topic searches. The shape matches the original `/api/outliers/videos` rows (minus the per-user bookmark/project fields) with `tier`, `titleFormat` and `source` added.

## Recipes

```bash
# Outliers about a topic from the last month, as a spreadsheet
hooklab search "ai agents" --min-outlier 5 --since 30d --csv > out.csv

# The 100 biggest outliers in Finance this year, titles only
hooklab top --since 2026-01-01 --niche Finance --limit 100 --jsonl | jq -r '"\(.outlierScore | floor)x  \(.title)"'

# Which click triggers do my niche's bangers use?
hooklab export --jsonl --niche "Social Media & Content Creation" --tier bangers,mega_bangers --fields clickTriggers \
  | jq -r '.clickTriggers[]' | sort | uniq -c | sort -rn | head

# Everything one channel has in the library
hooklab export --channel @kurzgesagt --csv --out kurzgesagt.csv

# How many Shorts the live pipeline added this week
hooklab search --shorts only --source rss --since 7d --count --limit 1 --json | jq .total

# Titles for an idea, as rows for a spreadsheet
hooklab titles "home espresso for beginners" --csv > espresso-titles.csv
```

## Adding a command

Commands live one per file in `cli/src/commands/<name>.ts` and default-export a `Command` (`cli/src/types.ts`): `{name, summary, usage, run(argv, ctx)}`. `main.ts` loads every file in that folder, so a new file is a new command (files starting with `_` are skipped; a command that fails to load is listed under "Not loaded" in `hooklab help` without breaking the others). `ctx.print(rows, columns?)` renders tables/JSON/JSONL/CSV, `ctx.info()` writes to stderr, `ctx.serverUrl` is `HOOKLAB_URL`. Throw `UsageError` (`cli/src/args.ts`) for bad input (exit 2); return a number to set the exit code. Library queries come from `cli/src/core.ts` (the shared query core); keep `main.ts` free of static imports from `app/` (see the note at its top).
