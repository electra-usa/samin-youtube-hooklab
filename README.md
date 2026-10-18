# HookLab

**AI YouTube titles grounded in real outliers, plus a live library of videos that beat their channel's average.**

HookLab is an open-source, self-hostable rebuild of a commercial YouTube title and outlier research tool. It was reverse engineered with [REA](https://github.com/morluto/rea) and rebuilt with AI coding agents ([how it was built](docs/HOW-IT-WAS-BUILT.md)). It contains no code, assets, or data from the original.

- **Chat:** describe a video and get title ideas grouped by angle. Each title is modelled on a real outlier, with click-trigger labels and a data-backed recommendation. It also writes thumbnail text, ideas, outlines, intros, competitor research and channel reviews. Runs on Claude Opus 5.5.
- **Outliers:** a searchable library of high-performing videos. Filters cover outlier tier, views, subscribers, date, niche, click trigger and title format, with topic, keyword and title-formula search.
- **Live pipeline:** polls channels for new uploads, scores outliers, tags them with Claude and discovers new channels, so new outliers show up as they happen.
- **Following, Bookmarks, My Channel** (your videos vs. your own average, view history, trophies), **Studio** (preview your title and thumbnail in a YouTube feed), **Projects**, **Settings**.
- **`hooklab` CLI and REST API** to pull the data anywhere: search, top outliers, channels, stats, CSV/JSONL export, title generation.

## Quick start

Requires Node.js 24 (it runs TypeScript directly). The chat and tagging need either an `ANTHROPIC_API_KEY` or a signed-in [Claude Code](https://claude.com/claude-code) CLI. `yt-dlp` is optional (transcripts, channel sync).

```bash
git clone https://github.com/Samin12/hooklab.git
cd hooklab/app
npm install
npm run dev -- -p 3210                # http://localhost:3210
```

Put keys in `app/.env.local`:

```bash
ANTHROPIC_API_KEY=sk-ant-…            # optional if Claude Code is signed in on this machine
SCRAPECREATORS_API_KEY=…              # optional: discovery, durations, subscriber counts
HOOKLAB_API_KEY=…                     # optional: require a key for /api/v1
```

## Fill the library

A fresh install starts with an empty library. Add channels you care about and let the pipeline take it from there:

```bash
node cli/bin/hooklab.mjs library add @veritasium @mkbhd https://www.youtube.com/@kurzgesagt
node cli/bin/hooklab.mjs refresh --discover        # poll feeds, score, tag, find new channels
node cli/bin/hooklab.mjs top --since 7d             # this week's biggest outliers
```

To keep it fresh, run the worker (`hooklab refresh --loop --every 60`), set `HOOKLAB_REFRESH_EVERY_MINUTES=60` for the server, or call `POST /api/v1/refresh` from cron. Polling uses YouTube's free channel feeds. ScrapeCreators runs under a daily credit budget. Details: [docs/LIVE-OUTLIERS.md](docs/LIVE-OUTLIERS.md).

## CLI

```bash
npm install -g ./cli                                 # or: node cli/bin/hooklab.mjs …
hooklab search "ai agents" --min-outlier 5 --since 30d
hooklab top --niche Finance --limit 20 --csv > finance.csv
hooklab channel @IBMTechnology
hooklab export --format jsonl --out library.jsonl
hooklab titles "I automated my YouTube channel with Claude"
```

Every command takes `--json`, `--jsonl` or `--csv`. See [docs/CLI.md](docs/CLI.md).

## API

```bash
curl "http://localhost:3210/api/v1/videos?q=claude%20code&minOutlier=3&since=30d&limit=50"
curl "http://localhost:3210/api/v1/export?format=csv&tier=bangers,mega_bangers" -o bangers.csv
curl -X POST http://localhost:3210/api/v1/titles -H 'Content-Type: application/json' -d '{"idea":"I rebuilt a paid app in a day"}'
```

The API covers videos (cursor paging), channels, stats, taxonomy, export, titles, refresh and library management. There's an OpenAPI 3.1 spec at `/api/v1/openapi.json`. See [docs/API.md](docs/API.md).

## Host it

Docker Compose runs the app and the refresh worker on one persistent `data/` volume:

```bash
cp app/.env.local .env && docker compose up -d --build
```

HookLab stores everything in SQLite on local disk, so it needs a host with a persistent volume (a VPS, a Mac mini, Fly.io, Railway). Serverless platforms like Vercel won't work. See [docs/DEPLOY.md](docs/DEPLOY.md).

## Project layout

| Path | What |
|---|---|
| `app/` | Next.js 16 app (App Router, Tailwind v4, built-in `node:sqlite`) |
| `app/src/lib/core/` | Framework-free data core shared by the app, CLI and worker: library schema, queries, live pipeline |
| `app/src/app/api/v1/` | Public REST API |
| `cli/` | `hooklab` command-line tool (no build step, no dependencies) |
| `docs/` | Feature notes: [chat](docs/CHAT.md), [research](docs/RESEARCH.md), [channel & studio](docs/CHANNEL-AND-STUDIO.md), [projects & settings](docs/PROJECTS-AND-SETTINGS.md), [CLI](docs/CLI.md), [API](docs/API.md), [live outliers](docs/LIVE-OUTLIERS.md), [deploy](docs/DEPLOY.md), [how it was built](docs/HOW-IT-WAS-BUILT.md) |
| `data/` | Your databases (`library.db`, `app.db`), created on first run; never committed |

## Notes

- Billing is a local ledger: plans and credit packs set your chat credit limit and nothing is ever charged. Edit `app/src/lib/billing/default-plans.ts` to set your own tiers.
- Thumbnail search uses title text; HookLab has no image embeddings.
- HookLab isn't affiliated with any YouTube tool it was inspired by. Respect YouTube's and your data providers' terms when you run the pipeline.

MIT licensed. See [LICENSE](LICENSE).
