// Starts the live outliers refresh loop inside the Next.js server when
// HOOKLAB_REFRESH_EVERY_MINUTES is set (off by default). Never during `next build`. The loop
// shares the run lock with `hooklab refresh --loop`, so running both is safe: whichever holds
// the lock runs, the other skips that tick.

type LoopHandle = { stop: () => Promise<void> };
const LOOP_KEY = Symbol.for("hooklab.refreshLoop");

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    if (process.env.NEXT_PHASE === "phase-production-build") return;
    const everyMinutes = Number(process.env.HOOKLAB_REFRESH_EVERY_MINUTES);
    if (!Number.isFinite(everyMinutes) || everyMinutes <= 0) return;
    const store = globalThis as typeof globalThis & { [LOOP_KEY]?: LoopHandle };
    if (store[LOOP_KEY]) return;
    const { startRefreshLoop } = await import("./lib/core/ingest/scheduler");
    store[LOOP_KEY] = startRefreshLoop({
      everyMinutes,
      trigger: "scheduler",
      // Let the server finish booting before the first run.
      initialDelayMs: Number(process.env.HOOKLAB_REFRESH_FIRST_DELAY_SECONDS ?? 30) * 1000,
      unref: true,
      log: (message) => console.log(`[hooklab refresh] ${message}`),
    });
  }
}
