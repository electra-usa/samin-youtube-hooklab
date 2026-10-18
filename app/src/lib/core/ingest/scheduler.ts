// The hosting loop: run a refresh every N minutes (measured from each run's start). Used by
// `hooklab refresh --loop` (the worker) and by the Next.js server when
// HOOKLAB_REFRESH_EVERY_MINUTES is set (src/instrumentation.ts). Both share the run lock, so
// when two loops run against one data directory each tick simply skips while the other works.
import os from "node:os";
import { RefreshBusyError, runRefresh, type RefreshSummary, type RefreshTrigger } from "./refresh.ts";
import { errorMessage, nowIso } from "./util.ts";
import { createLibraryWriter } from "./writer.ts";

export type LoopOptions = {
  everyMinutes: number;
  trigger: Extract<RefreshTrigger, "worker" | "scheduler">;
  channels?: number;
  discover?: boolean;
  /** Wait before the first run (default 0; the server uses a short delay to finish booting). */
  initialDelayMs?: number;
  /** Let the process exit while the loop waits (in-process scheduler); the worker keeps it alive. */
  unref?: boolean;
  log?: (message: string) => void;
  onRun?: (summary: RefreshSummary) => void;
};

export type RefreshLoop = { stop: () => Promise<void>; nextRunAt: () => string | null };

function saveState(trigger: string, everyMinutes: number, nextRunAt: string | null, stopped = false) {
  try {
    const value = JSON.stringify({
      owner: trigger,
      pid: process.pid,
      host: os.hostname(),
      everyMinutes,
      nextRunAt,
      updatedAt: nowIso(),
      ...(stopped ? { stoppedAt: nowIso() } : {}),
    });
    createLibraryWriter().write((db) =>
      db.prepare("INSERT INTO ingest_state (key, value) VALUES ('scheduler', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(value),
    );
  } catch {
    // Status display only.
  }
}

export function summaryLine(s: RefreshSummary): string {
  const secs = Math.round(s.durationMs / 1000);
  return (
    `run ${s.id} ${s.status} in ${secs}s: ${s.channelsPolled}/${s.channelsPlanned} channels, ${s.newVideos} new videos, ` +
    `${s.updatedVideos} refreshed, ${s.newOutliers} new outliers, ${s.tagged} tagged, ${s.discoveredChannels} discovered, ` +
    `${s.creditsUsed} credits, ${s.errors} errors`
  );
}

export function startRefreshLoop(opts: LoopOptions): RefreshLoop {
  const everyMs = Math.max(1, opts.everyMinutes) * 60_000;
  const log = opts.log ?? (() => {});
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | null = null;
  let next: number | null = null;
  let current: Promise<unknown> | null = null;
  let stopped = false;

  const schedule = (delayMs: number) => {
    if (stopped) return;
    next = Date.now() + delayMs;
    saveState(opts.trigger, opts.everyMinutes, new Date(next).toISOString());
    timer = setTimeout(tick, delayMs);
    if (opts.unref) timer.unref?.();
  };

  const tick = async () => {
    timer = null;
    if (stopped) return;
    const started = Date.now();
    next = null;
    saveState(opts.trigger, opts.everyMinutes, null);
    const work = runRefresh({ trigger: opts.trigger, channels: opts.channels, discover: opts.discover, signal: controller.signal, log })
      .then((summary) => {
        log(summaryLine(summary));
        opts.onRun?.(summary);
      })
      .catch((err) => {
        if (err instanceof RefreshBusyError) log(`skipped: ${err.message}`);
        else log(`refresh failed: ${errorMessage(err)}`);
      });
    current = work;
    await work;
    current = null;
    schedule(Math.max(5_000, started + everyMs - Date.now()));
  };

  schedule(Math.max(0, opts.initialDelayMs ?? 0));
  log(`refresh loop started: every ${opts.everyMinutes} min`);

  return {
    nextRunAt: () => (next ? new Date(next).toISOString() : null),
    stop: async () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      controller.abort();
      await current;
      saveState(opts.trigger, opts.everyMinutes, null, true);
    },
  };
}
