// One refresh run: pick the channels due for polling, fetch their RSS feeds (politely, a few
// at a time), apply the uploads in short batches, then fill durations for new outliers, tag
// them with Claude and optionally discover new channels. Runs are logged in refresh_runs and
// serialized by the lockfile, so the Next.js scheduler, the API and the CLI worker can share
// one library.
import { libraryReader } from "./reader.ts";
import { applyChannelPoll, applyPollFailure, mergeAllDuplicates, type ApplyStats, type ChannelPoll } from "./apply.ts";
import { selectChannels, selectDueChannels, type Candidate } from "./channels.ts";
import { discoverChannels } from "./discover.ts";
import { enrichOutliers } from "./enrich.ts";
import { rateLimited, requestsSent, resetRateLimit } from "./http.ts";
import { acquireLock, readLock, type LockState, type RefreshLock } from "./lock.ts";
import { pollChannel } from "./poll.ts";
import { NEW_OUTLIER_MAX_AGE_DAYS, ingestSettings, type TaggingMode } from "./settings.ts";
import { tagNewVideos } from "./tagging.ts";
import { errorMessage, hoursAgoIso, mapLimit, nowIso } from "./util.ts";
import { createLibraryWriter, type LibraryWriter } from "./writer.ts";

export type RefreshTrigger = "cli" | "worker" | "api" | "scheduler";

export type RefreshOptions = {
  /** Channels to poll this run (default HOOKLAB_REFRESH_CHANNELS, 300). 0 skips polling. */
  channels?: number;
  /** Poll exactly these channels instead of the due ones. */
  channelIds?: string[];
  concurrency?: number;
  /** true/false forces discovery on/off; undefined follows HOOKLAB_DISCOVER and its interval. */
  discover?: boolean;
  discoverQueries?: number;
  /** Fetch and score, but write nothing (no lock, no paid calls, no tagging). */
  dryRun?: boolean;
  tagging?: TaggingMode;
  enrich?: boolean;
  trigger?: RefreshTrigger;
  signal?: AbortSignal;
  log?: (message: string) => void;
};

export type RefreshRun = {
  id: number;
  startedAt: string;
  finishedAt: string | null;
  status: "running" | "ok" | "partial" | "failed" | "aborted" | "dry_run";
  trigger: string;
  dryRun: boolean;
  channelsPlanned: number;
  channelsPolled: number;
  requests: number;
  newVideos: number;
  updatedVideos: number;
  newOutliers: number;
  enriched: number;
  tagged: number;
  discoveredChannels: number;
  creditsUsed: number;
  aiCostUsd: number;
  errors: number;
  errorSample: string[];
  options: Record<string, unknown>;
};

export type TopOutlier = { id: string; videoId: string; title: string; channelName: string | null; views: number | null; outlierScore: number | null; publishAt: string | null; isShort: boolean };

export type RefreshSummary = RefreshRun & { durationMs: number; topOutliers: TopOutlier[]; discovered: { channelId: string; name: string | null; ratio: number }[] };

export class RefreshBusyError extends Error {
  readonly lock: LockState | null;
  constructor(lock: LockState | null) {
    super(lock ? `A refresh is already running (run ${lock.runId ?? "?"}, started ${lock.startedAt} by ${lock.owner}).` : "A refresh is already running.");
    this.name = "RefreshBusyError";
    this.lock = lock;
  }
}

type RunDbRow = {
  id: number;
  started_at: string;
  finished_at: string | null;
  status: RefreshRun["status"];
  trigger: string;
  dry_run: number;
  channels_planned: number;
  channels_polled: number;
  requests: number;
  new_videos: number;
  updated_videos: number;
  new_outliers: number;
  enriched: number;
  tagged: number;
  discovered_channels: number;
  credits_used: number;
  ai_cost_usd: number;
  errors: number;
  error_sample: string | null;
  options: string | null;
};

const parseJson = <T>(s: string | null, fallback: T): T => {
  try {
    return s ? (JSON.parse(s) as T) : fallback;
  } catch {
    return fallback;
  }
};

export function toRun(r: RunDbRow): RefreshRun {
  return {
    id: r.id,
    startedAt: r.started_at,
    finishedAt: r.finished_at,
    status: r.status,
    trigger: r.trigger,
    dryRun: !!r.dry_run,
    channelsPlanned: r.channels_planned,
    channelsPolled: r.channels_polled,
    requests: r.requests,
    newVideos: r.new_videos,
    updatedVideos: r.updated_videos,
    newOutliers: r.new_outliers,
    enriched: r.enriched,
    tagged: r.tagged,
    discoveredChannels: r.discovered_channels,
    creditsUsed: r.credits_used,
    aiCostUsd: Math.round(r.ai_cost_usd * 10_000) / 10_000,
    errors: r.errors,
    errorSample: parseJson<string[]>(r.error_sample, []),
    options: parseJson<Record<string, unknown>>(r.options, {}),
  };
}

export function getRun(id: number): RefreshRun | null {
  const row = libraryReader().prepare("SELECT * FROM refresh_runs WHERE id = ?").get(id) as RunDbRow | undefined;
  return row ? toRun(row) : null;
}

export function listRuns(limit = 20): RefreshRun[] {
  return (libraryReader().prepare("SELECT * FROM refresh_runs ORDER BY id DESC LIMIT ?").all(limit) as RunDbRow[]).map(toRun);
}

type Counters = Omit<RefreshRun, "id" | "startedAt" | "finishedAt" | "status" | "trigger" | "dryRun" | "errorSample" | "options">;

function setState(writer: LibraryWriter, entries: Record<string, string>) {
  writer.write((db) => {
    for (const [key, value] of Object.entries(entries)) {
      db.prepare("INSERT INTO ingest_state (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(key, value);
    }
  });
}

export function getState(key: string): string | null {
  try {
    const row = libraryReader().prepare("SELECT value FROM ingest_state WHERE key = ?").get(key) as { value: string } | undefined;
    return row?.value ?? null;
  } catch {
    return null;
  }
}

/**
 * Start a run: takes the lock and logs the run synchronously (so callers can answer 409 or
 * return the run row right away); the work continues in `done`.
 */
export function startRefresh(opts: RefreshOptions = {}): { run: RefreshRun; done: Promise<RefreshSummary> } {
  const settings = ingestSettings();
  const dryRun = !!opts.dryRun;
  const trigger = opts.trigger ?? "cli";
  let lock: RefreshLock | null = null;
  if (!dryRun) {
    lock = acquireLock(trigger);
    if (!lock) throw new RefreshBusyError(readLock());
  }
  const writer = createLibraryWriter();
  const options = {
    channels: opts.channelIds?.length ? opts.channelIds.length : (opts.channels ?? settings.channelsPerRun),
    channelIds: opts.channelIds?.length ? opts.channelIds : undefined,
    concurrency: opts.concurrency ?? settings.concurrency,
    discover: opts.discover,
    dryRun,
    tagging: dryRun ? "off" : (opts.tagging ?? settings.tagging),
    enrich: dryRun ? false : (opts.enrich ?? true),
  };
  let runId: number;
  try {
    const startedAt = nowIso();
    runId = writer.write((db) => {
      if (!dryRun) {
        // We hold the lock, so anything still marked running died without finishing.
        db.prepare("UPDATE refresh_runs SET status = 'aborted', finished_at = COALESCE(finished_at, ?) WHERE status = 'running'").run(startedAt);
      }
      const r = db
        .prepare("INSERT INTO refresh_runs (started_at, status, trigger, dry_run, options) VALUES (?, ?, ?, ?, ?)")
        .run(startedAt, dryRun ? "dry_run" : "running", trigger, dryRun ? 1 : 0, JSON.stringify(options));
      return Number(r.lastInsertRowid);
    });
  } catch (err) {
    lock?.release();
    throw err;
  }
  lock?.setRunId(runId);
  const run = getRun(runId) as RefreshRun;
  const done = execute(runId, run.startedAt, writer, lock, { ...opts, ...options, trigger });
  return { run, done };
}

export async function runRefresh(opts: RefreshOptions = {}): Promise<RefreshSummary> {
  return startRefresh(opts).done;
}

const ZERO: Counters = {
  channelsPlanned: 0,
  channelsPolled: 0,
  requests: 0,
  newVideos: 0,
  updatedVideos: 0,
  newOutliers: 0,
  enriched: 0,
  tagged: 0,
  discoveredChannels: 0,
  creditsUsed: 0,
  aiCostUsd: 0,
  errors: 0,
};

async function execute(
  runId: number,
  startedAt: string,
  writer: LibraryWriter,
  lock: RefreshLock | null,
  opts: RefreshOptions & { channels: number; concurrency: number; tagging: TaggingMode; enrich: boolean; trigger: RefreshTrigger },
): Promise<RefreshSummary> {
  const settings = ingestSettings();
  const dryRun = !!opts.dryRun;
  const log = opts.log ?? (() => {});
  const t0 = Date.now();
  const c: Counters = { ...ZERO };
  const errors: string[] = [];
  const outlierRowIds = new Set<string>();
  const discovered: RefreshSummary["discovered"] = [];
  let status: RefreshRun["status"] = dryRun ? "dry_run" : "ok";
  resetRateLimit();
  const requestsAtStart = requestsSent();
  const stillHeld = () => !lock || lock.held();

  const progress = () => {
    if (dryRun) return;
    writer.write((db) =>
      db
        .prepare(
          `UPDATE refresh_runs SET channels_planned = ?, channels_polled = ?, requests = ?, new_videos = ?, updated_videos = ?,
             new_outliers = ?, enriched = ?, tagged = ?, discovered_channels = ?, errors = ?, error_sample = ? WHERE id = ?`,
        )
        .run(
          c.channelsPlanned,
          c.channelsPolled,
          requestsSent() - requestsAtStart,
          c.newVideos,
          c.updatedVideos,
          c.newOutliers,
          c.enriched,
          c.tagged,
          c.discoveredChannels,
          errors.length,
          JSON.stringify(errors.slice(0, 20)),
          runId,
        ),
    );
  };

  const add = (s: ApplyStats) => {
    c.newVideos += s.newVideos;
    c.updatedVideos += s.updatedVideos;
    c.newOutliers += s.newOutliers;
    for (const id of s.outlierRowIds) outlierRowIds.add(id);
  };

  const applyBatch = (batch: ChannelPoll[]) => {
    if (!batch.length) return;
    const now = nowIso();
    if (dryRun) {
      const reader = libraryReader();
      for (const p of batch) add(applyChannelPoll(reader, p, { now, dryRun: true }));
      return;
    }
    const results = writer.write((db) =>
      batch.map((p) => {
        if (!p.videos.length) {
          applyPollFailure(db, p, now);
          return null;
        }
        return applyChannelPoll(db, p, { now });
      }),
    );
    for (const s of results) if (s) add(s);
    progress();
  };

  const pollAll = async (plan: Pick<Candidate, "channelId" | "hasShorts" | "shortsCheckedAt">[]) => {
    let pending: ChannelPoll[] = [];
    let lastFlush = Date.now();
    await mapLimit(plan, opts.concurrency, async (candidate) => {
      if (opts.signal?.aborted || rateLimited() || !stillHeld()) return;
      const poll = await pollChannel(candidate, { shorts: settings.shorts, signal: opts.signal });
      c.channelsPolled++;
      if (poll.error) errors.push(`${candidate.channelId}: ${poll.error}`);
      pending.push(poll);
      if (pending.length >= 25 || Date.now() - lastFlush > 5_000) {
        const batch = pending;
        pending = [];
        lastFlush = Date.now();
        applyBatch(batch);
      }
    });
    applyBatch(pending);
  };

  try {
    if (!dryRun) {
      const merged = writer.write((db) => mergeAllDuplicates(db));
      if (merged) log(`merged ${merged} live rows into export rows for the same videos`);
    }
    const reader = libraryReader();
    const plan = opts.channelIds?.length
      ? selectChannels(reader, opts.channelIds)
      : opts.channels > 0
        ? selectDueChannels(reader, opts.channels)
        : [];
    c.channelsPlanned = plan.length;
    progress();
    if (plan.length) log(`polling ${plan.length} channels (${opts.concurrency} at a time)`);
    await pollAll(plan);
    if (rateLimited()) errors.push("YouTube answered 429 repeatedly; stopped polling early");
    if (!stillHeld()) errors.push("lost the refresh lock to another process; stopped early");
    log(`polled ${c.channelsPolled} channels: ${c.newVideos} new videos, ${c.updatedVideos} refreshed, ${c.newOutliers} new outliers`);

    // Discovery adds channels and polls them right away (RSS is free).
    const lastDiscovery = getState("last_discovery_at");
    const discoveryDue =
      opts.discover ?? (settings.discover && (!lastDiscovery || Date.now() - Date.parse(lastDiscovery) >= settings.discoverEveryHours * 3_600_000));
    if (!dryRun && discoveryDue && !opts.signal?.aborted) {
      const d = await discoverChannels(writer, { queries: opts.discoverQueries ?? settings.discoverQueries, runId, signal: opts.signal, log });
      errors.push(...d.errors);
      setState(writer, { last_discovery_at: nowIso() });
      c.discoveredChannels = d.added.length;
      discovered.push(...d.added.map((a) => ({ channelId: a.channelId, name: a.name, ratio: Math.round(a.ratio * 100) / 100 })));
      if (d.added.length) {
        log(`discovery: ${d.queries.length} queries, ${d.candidates} candidates, ${d.added.length} channels added`);
        await pollAll(d.added.map((a) => ({ channelId: a.channelId, hasShorts: null, shortsCheckedAt: null })));
      }
    }

    if (!dryRun && opts.enrich && !opts.signal?.aborted) {
      const e = await enrichOutliers(writer, { runId, maxCalls: settings.enrichMaxCalls, maxPages: settings.enrichMaxPages, signal: opts.signal, log });
      c.enriched = e.enriched;
      errors.push(...e.errors);
    }
    if (!dryRun && opts.tagging !== "off" && !opts.signal?.aborted) {
      const t = await tagNewVideos(writer, {
        mode: opts.tagging,
        model: settings.taggingModel,
        batchSize: settings.taggingBatchSize,
        maxBatches: settings.taggingMaxBatches,
        signal: opts.signal,
        log,
      });
      c.tagged = t.tagged;
      c.aiCostUsd = t.costUsd;
      errors.push(...t.errors);
    }
    if (opts.signal?.aborted) status = "aborted";
    else if (!dryRun && errors.length) status = "partial";
  } catch (err) {
    status = "failed";
    errors.unshift(errorMessage(err));
    log(`refresh failed: ${errorMessage(err)}`);
  }

  const finishedAt = nowIso();
  c.requests = requestsSent() - requestsAtStart;
  c.errors = errors.length;
  try {
    const credits = libraryReader().prepare("SELECT COALESCE(SUM(credits_charged), 0) AS n FROM scrapecreators_calls WHERE run_id = ?").get(runId) as { n: number };
    c.creditsUsed = Number(credits.n);
    writer.write((db) => {
      db.prepare(
        `UPDATE refresh_runs SET finished_at = ?, status = ?, channels_planned = ?, channels_polled = ?, requests = ?, new_videos = ?,
           updated_videos = ?, new_outliers = ?, enriched = ?, tagged = ?, discovered_channels = ?, credits_used = ?, ai_cost_usd = ?,
           errors = ?, error_sample = ? WHERE id = ?`,
      ).run(
        finishedAt,
        status,
        c.channelsPlanned,
        c.channelsPolled,
        c.requests,
        c.newVideos,
        c.updatedVideos,
        c.newOutliers,
        c.enriched,
        c.tagged,
        c.discoveredChannels,
        c.creditsUsed,
        c.aiCostUsd,
        c.errors,
        JSON.stringify(errors.slice(0, 20)),
        runId,
      );
      if (!dryRun && status !== "failed") {
        db.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES ('last_refresh_at', ?)").run(finishedAt);
        db.prepare("INSERT INTO ingest_state (key, value) VALUES ('last_refresh_at', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(finishedAt);
      }
    });
    await writer.settle();
  } catch (err) {
    log(`couldn't finalize run ${runId}: ${errorMessage(err)}`);
  } finally {
    lock?.release();
  }

  const run: RefreshRun = getRun(runId) ?? {
    id: runId,
    startedAt,
    finishedAt,
    status,
    trigger: opts.trigger,
    dryRun,
    errorSample: errors.slice(0, 20),
    options: {},
    ...c,
  };
  return { ...run, durationMs: Date.now() - t0, topOutliers: dryRun ? [] : topOutliers([...outlierRowIds]), discovered };
}

/** The run's new outliers among recent uploads (older videos crossing 2x on first sight aren't news). */
function topOutliers(rowIds: string[]): TopOutlier[] {
  if (!rowIds.length) return [];
  const rows = libraryReader()
    .prepare(
      `SELECT id, video_id AS videoId, title, channel_name AS channelName, views, outlier_score AS outlierScore, publish_at AS publishAt, is_short AS isShort
       FROM videos WHERE id IN (SELECT value FROM json_each(?)) AND publish_at >= ? ORDER BY outlier_score DESC LIMIT 10`,
    )
    .all(JSON.stringify(rowIds), hoursAgoIso(NEW_OUTLIER_MAX_AGE_DAYS * 24)) as (Omit<TopOutlier, "isShort"> & { isShort: number })[];
  return rows.map((r) => ({ ...r, isShort: !!r.isShort }));
}
