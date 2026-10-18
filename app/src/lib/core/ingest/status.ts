// Read-only views of the pipeline for the API, the CLI and the Outliers page.
import os from "node:os";
import { libraryReader } from "./reader.ts";
import { readLock } from "./lock.ts";
import { getRun, getState, toRun, type RefreshRun } from "./refresh.ts";
import { scBudget } from "./scrapecreators.ts";
import { NEW_OUTLIER_MAX_AGE_DAYS, OUTLIER_THRESHOLD } from "./settings.ts";
import { hoursAgoIso } from "./util.ts";

export type SchedulerState = {
  owner: string;
  pid: number;
  host: string;
  everyMinutes: number;
  nextRunAt: string | null;
  updatedAt: string;
  /** Heard from within two intervals (the loop rewrites this state every run). */
  active: boolean;
};

function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === "EPERM";
  }
}

export function schedulerState(): SchedulerState | null {
  const raw = getState("scheduler");
  if (!raw) return null;
  try {
    const s = JSON.parse(raw) as Omit<SchedulerState, "active"> & { stoppedAt?: string };
    const age = Date.now() - Date.parse(s.updatedAt);
    const gone = s.host === os.hostname() && !processAlive(s.pid);
    const active = !s.stoppedAt && !gone && age < Math.max(2 * s.everyMinutes * 60_000, 5 * 60_000) + 60_000;
    return { owner: s.owner, pid: s.pid, host: s.host, everyMinutes: s.everyMinutes, nextRunAt: active ? s.nextRunAt : null, updatedAt: s.updatedAt, active };
  } catch {
    return null;
  }
}

const count = (sql: string, ...params: (string | number)[]) => {
  try {
    return Number((libraryReader().prepare(sql).get(...params) as { n: number }).n);
  } catch {
    return 0;
  }
};

function lastFinishedRun(): RefreshRun | null {
  const row = libraryReader()
    .prepare("SELECT * FROM refresh_runs WHERE dry_run = 0 AND status != 'running' ORDER BY id DESC LIMIT 1")
    .get() as Parameters<typeof toRun>[0] | undefined;
  return row ? toRun(row) : null;
}

export function liveCounts() {
  const since = hoursAgoIso(24);
  return {
    newVideos24h: count("SELECT count(*) AS n FROM live_videos WHERE origin = 'new' AND first_seen_at >= ?", since),
    newOutliers24h: count(
      `SELECT count(*) AS n FROM live_videos lv JOIN videos v ON v.id = lv.row_id
       WHERE lv.outlier_at >= ? AND v.outlier_score >= ? AND v.publish_at >= ?`,
      since,
      OUTLIER_THRESHOLD,
      hoursAgoIso(NEW_OUTLIER_MAX_AGE_DAYS * 24),
    ),
  };
}

export function refreshStatus() {
  const lock = readLock();
  const running = !!lock && !lock.stale;
  const scheduler = schedulerState();
  const budget = scBudget();
  return {
    running,
    run: running && lock?.runId ? getRun(lock.runId) : null,
    lock: lock ? { owner: lock.owner, host: lock.host === os.hostname() ? "this machine" : lock.host, startedAt: lock.startedAt, heartbeatAt: lock.heartbeatAt, stale: lock.stale } : null,
    lastRun: lastFinishedRun(),
    lastRefreshAt: getState("last_refresh_at"),
    nextRunAt: scheduler?.nextRunAt ?? null,
    scheduler,
    totals: {
      videos: count("SELECT count(*) AS n FROM videos"),
      liveVideos: count("SELECT count(*) AS n FROM live_videos"),
      pipelineVideos: count("SELECT count(*) AS n FROM live_videos WHERE origin = 'new'"),
      ...liveCounts(),
      libraryChannels: count("SELECT count(*) AS n FROM library_channels"),
      channelsPolled24h: count("SELECT count(*) AS n FROM channel_poll_state WHERE last_polled_at >= ?", hoursAgoIso(24)),
      creditsRemaining: budget.creditsRemaining,
      creditsUsed24h: budget.usedLast24h,
      dailyCreditBudget: budget.dailyBudget,
    },
  };
}

/** Compact freshness line for the Outliers page. */
export function libraryFreshness() {
  const lock = readLock();
  let builtAt: string | null = null;
  try {
    builtAt = (libraryReader().prepare("SELECT value FROM meta WHERE key = 'built_at'").get() as { value: string } | undefined)?.value ?? null;
  } catch {
    builtAt = null;
  }
  const lastRefreshAt = getState("last_refresh_at");
  const updatedAt = [lastRefreshAt, builtAt].filter((x): x is string => !!x).sort().at(-1) ?? null;
  return { updatedAt, lastRefreshAt, builtAt, running: !!lock && !lock.stale, ...liveCounts() };
}
