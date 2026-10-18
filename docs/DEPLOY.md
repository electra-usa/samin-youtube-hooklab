# Deploying HookLab

HookLab is one Next.js app plus a worker (`hooklab refresh --loop`) that keeps the outlier library current (see `docs/LIVE-OUTLIERS.md`). All state is two SQLite files in one data directory: `library.db` (videos, channels, pipeline tables) and `app.db` (your chats, projects, bookmarks, settings). So a deployment needs:

- **one machine or container group with a persistent disk** mounted as the data directory (`HOOKLAB_DATA_DIR`, `/data` in the image);
- **one instance**: SQLite on local disk, a lockfile for refresh runs, no shared cache;
- **outbound internet**: YouTube RSS and pages, ScrapeCreators, Anthropic;
- secrets as environment variables: `SCRAPECREATORS_API_KEY`, `ANTHROPIC_API_KEY` (the Claude Code CLI isn't in the image), and `HOOKLAB_API_KEY` to protect `/api/v1`.

## Contents

- [Docker Compose on a VPS](#docker-compose-on-a-vps-recommended)
- [Mac mini or another always-on Mac](#mac-mini-or-another-always-on-mac)
- [Fly.io](#flyio)
- [Railway](#railway)
- [Why not Vercel](#why-not-vercel-or-other-serverless-hosts)
- [Cron instead of a worker](#cron-instead-of-a-worker)
- [Bringing your data](#bringing-your-data)
- [Security](#security)
- [Operations](#operations)

## Docker Compose on a VPS (recommended)

Any small Linux VM works: Hetzner CX22, DigitalOcean, Lightsail, with 2 GB RAM and 10 GB of disk for a ~300K-video library. The repo's `Dockerfile` builds one image (node:24-slim, `next build`, production dependencies); `docker-compose.yml` runs it twice, sharing `./data`:

| Service | Command | Role |
|---|---|---|
| `app` | `next start` on port 3000 (published as `HOOKLAB_PORT`, default 3210) | Web app and `/api/v1`; in-process scheduler off |
| `worker` | `node cli/bin/hooklab.mjs refresh --loop --every 60` | Polls channel feeds hourly, tags, enriches, discovers when `HOOKLAB_DISCOVER=on` |

```bash
git clone <your fork> hooklab && cd hooklab
cat > .env <<'EOF'
SCRAPECREATORS_API_KEY=...
ANTHROPIC_API_KEY=...
HOOKLAB_API_KEY=a-long-random-string
SCRAPECREATORS_DAILY_CREDITS=100
HOOKLAB_DISCOVER=on
EOF
mkdir -p data && sudo chown -R 1000:1000 data     # the containers run as the unprivileged node user (uid 1000)
docker compose up -d --build
docker compose logs -f worker                      # "run 12 ok in 74s: 300/300 channels, …"
```

Optional build argument `INSTALL_YTDLP=true` adds the standalone `yt-dlp` binary (~35 MB). Only My Channel sync and transcript attachments use it; the refresh pipeline doesn't. If `./data` isn't writable by uid 1000, the app container exits right away with a message saying so. On Docker Desktop or colima, bind mounts under your home folder work as they are; a directory outside the VM's shared folders (such as `/tmp` on colima) shows up empty and owned by root.

Put a TLS reverse proxy in front: Caddy (`reverse_proxy localhost:3210`), nginx, or a Cloudflare Tunnel. See [Security](#security): the web UI has no login of its own.

## Mac mini or another always-on Mac

The simplest host if you already have one. Either run the Compose stack under Docker Desktop or colima, as above, or run it natively:

```bash
cd app && npm ci && npm run build
HOOKLAB_REFRESH_EVERY_MINUTES=60 npm run start -- -p 3210      # app + in-process scheduler in one process
```

For a separate worker instead, run `node cli/bin/hooklab.mjs refresh --loop --every 60` next to `npm run start`. Keep both alive with `launchd` (a LaunchAgent with `KeepAlive`), `pm2`, or `brew services`-style wrappers. Expose it with Tailscale (private) or a Cloudflare Tunnel (public). The machine shouldn't sleep (`sudo pmset -a sleep 0`), or the loop pauses with it.

## Fly.io

Fly volumes attach to one machine, which matches HookLab's single-instance model. Run the app and the worker as two process groups of one app on the same machine and volume, or keep it to one process with the in-process scheduler:

```toml
# fly.toml (sketch)
app = "hooklab"
[build]
  dockerfile = "Dockerfile"
[env]
  HOOKLAB_DATA_DIR = "/data"
  HOOKLAB_REFRESH_EVERY_MINUTES = "60"     # one process: the server runs the loop
[[mounts]]
  source = "hooklab_data"
  destination = "/data"
[http_service]
  internal_port = 3000
  force_https = true
  auto_stop_machines = "off"                # a stopped machine doesn't poll
  min_machines_running = 1
```

```bash
fly volumes create hooklab_data --size 10
fly secrets set SCRAPECREATORS_API_KEY=... ANTHROPIC_API_KEY=... HOOKLAB_API_KEY=...
fly deploy
```

Separate process groups each get their own machine, and a volume can't be shared between machines. So on Fly, use the in-process scheduler, or run the worker inside the same machine with a small process supervisor.

## Railway

Same shape: one service from the Dockerfile with a volume mounted at `/data` (Railway volumes attach to a single service), `HOOKLAB_REFRESH_EVERY_MINUTES=60` so the web process runs the loop, and secrets in the service's variables. Keep the service always on (no app sleeping). A second "worker" service can't share the volume, so don't split them. If you'd rather trigger runs from outside, use Railway's cron with the [curl call below](#cron-instead-of-a-worker).

## Why not Vercel (or other serverless hosts)

- **No persistent local disk.** Functions run on read-only, ephemeral filesystems. `library.db` and `app.db` would be thrown away (or couldn't be written at all) between invocations, and the refresh pipeline writes thousands of rows per run.
- **No long-running work.** A refresh run takes 1–3 minutes and the worker loops forever. Serverless functions are request-scoped with execution limits, and there's no place for `instrumentation.ts`'s background loop.
- **SQLite needs a single writer on a real filesystem.** Many concurrent function instances can't share one file safely, and the run lock is a file too.

Making HookLab serverless would mean moving both databases to a hosted store (Turso/libSQL, Postgres) and the loop to a queue or cron function. That isn't done here. Vercel Cron alone can't fix it, because the data still has nowhere to live.

## Cron instead of a worker

If the host has a scheduler but no always-on worker process, start runs over HTTP. The app runs them in its own process and answers right away:

```bash
# every hour, e.g. crontab: 0 * * * *
curl -fsS -X POST https://hooklab.example.com/api/v1/refresh \
  -H "Authorization: Bearer $HOOKLAB_API_KEY" \
  -H 'Content-Type: application/json' \
  -d '{"channels": 300, "discover": false}'
# 202 {"run": {...}}; 409 {"error":{"code":"refresh_running"}} when the previous run is still going: skip it
```

Run discovery less often (e.g. every 6 hours: `-d '{"channels": 0, "discover": true, "discoverQueries": 3}'`). Check on it with `GET /api/v1/refresh/status` (running, last run, totals, credits) and `GET /api/v1/refresh/runs`. GitHub Actions `schedule:`, cron-job.org, Railway cron and a plain crontab all work. The process must stay up for the 1–3 minutes a run takes after the 202, so this needs a long-lived server, not a function.

## Bringing your data

The image contains no data (`.dockerignore` excludes `data/`, `evidence/`, `research/`, `scripts/` and every `.env`). Either:

- **Start empty.** The app creates both databases on first run. Add channels with `docker compose exec worker node cli/bin/hooklab.mjs library add @handle`, or let discovery find some. With no library channels yet, runs have nothing to poll.
- **Bring your library.** Stop the stack and copy `data/library.db` and `data/app.db` into the volume (`scp`, `rsync`, or `fly ssh sftp`). Copy the files whole, while nothing is writing. `taxonomy.json` and the account export aren't needed at runtime; the app ships its own taxonomy.

The bulk rebuild script (`scripts/private/build-db.py`) only matters on the machine that runs the Creator Hooks export. A hosted copy never rebuilds; it only grows through the pipeline.

## Security

- `HOOKLAB_API_KEY` protects every `/api/v1` endpoint (`Authorization: Bearer …` or `x-api-key`) except `GET /api/v1/refresh/freshness`, which the Outliers page reads for its "Library updated …" line. Without a key, anyone who can reach the server can start refresh runs and spend ScrapeCreators credits, within the daily budget.
- The web UI itself has no accounts. It's a single-user app, so don't expose it to the public internet as is: put it behind an authenticating proxy (Cloudflare Access, Tailscale, Caddy `basic_auth`, oauth2-proxy).
- Keys live in the environment (`.env`, platform secrets), never in the image. The ScrapeCreators key is never logged.

## Operations

- **Health.** The image's `HEALTHCHECK` calls `/api/v1/refresh/freshness`. `GET /api/v1/refresh/status` shows `running`, `lastRun` (status, counts, errors), `nextRunAt` and its owner, `totals.newOutliers24h`, `channelsPolled24h` and credits. From a shell: `hooklab refresh status` and `hooklab refresh runs`.
- **Logs.** The worker prints one line per run. The app prints `[hooklab refresh] …` for scheduler and API runs.
- **Backups.** Copy `library.db` and `app.db` between runs, or online with `sqlite3 data/library.db ".backup backup.db"`. `refresh_runs` and `ingest_state` say when the last run finished.
- **Stuck lock.** A crashed run's lock goes stale after 10 minutes (sooner on the same machine, once its process is gone); the next run takes over and marks the old run `aborted`. Don't delete `data/refresh.lock` while a run is going.
- **Tuning.** `HOOKLAB_REFRESH_CHANNELS` and the loop interval set throughput; `SCRAPECREATORS_DAILY_CREDITS`, `HOOKLAB_ENRICH_MAX_CALLS` and `HOOKLAB_TAGGING_MAX_BATCHES` cap spend. Every setting is in `docs/LIVE-OUTLIERS.md#settings`.
- **Updating.** `git pull && docker compose up -d --build`. Schema changes apply themselves on open (`CREATE … IF NOT EXISTS`).
