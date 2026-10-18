// Live outliers pipeline settings, all env-driven (app/.env.local, or the container env).
// Framework-free: shared by the Next.js server, the hooklab CLI and the worker.

export type TaggingMode = "outliers" | "all" | "off";

const num = (value: string | undefined, fallback: number, min = 0) => {
  const n = value == null || value.trim() === "" ? Number.NaN : Number(value);
  return Number.isFinite(n) && n >= min ? n : fallback;
};

const flag = (value: string | undefined, fallback: boolean) => {
  if (value == null || value.trim() === "") return fallback;
  return /^(1|true|yes|on)$/i.test(value.trim());
};

export function ingestSettings() {
  const env = process.env;
  const tagging = (env.HOOKLAB_TAGGING ?? "outliers").trim().toLowerCase();
  return {
    /** In-process scheduler interval (Next.js server). 0 = off. */
    everyMinutes: num(env.HOOKLAB_REFRESH_EVERY_MINUTES, 0),
    /** Channels polled per run. */
    channelsPerRun: Math.floor(num(env.HOOKLAB_REFRESH_CHANNELS, 300, 1)),
    /** Parallel feed requests. */
    concurrency: Math.min(16, Math.floor(num(env.HOOKLAB_REFRESH_CONCURRENCY, 6, 1))),
    /** Track Shorts through each channel's UUSH feed as well. */
    shorts: flag(env.HOOKLAB_SHORTS, true),
    /** Run discovery inside scheduled runs (the CLI's --discover forces it for one run). */
    discover: flag(env.HOOKLAB_DISCOVER, false),
    discoverEveryHours: num(env.HOOKLAB_DISCOVER_EVERY_HOURS, 6),
    discoverQueries: Math.floor(num(env.HOOKLAB_DISCOVER_QUERIES, 3, 1)),
    /** A discovered channel is kept when a this-week video has at least this many views per subscriber. */
    discoverMinRatio: num(env.HOOKLAB_DISCOVER_MIN_RATIO, 1),
    discoverMinViews: num(env.HOOKLAB_DISCOVER_MIN_VIEWS, 20_000),
    tagging: (tagging === "all" || tagging === "off" ? tagging : "outliers") as TaggingMode,
    taggingModel: env.HOOKLAB_TAGGING_MODEL?.trim() || "claude-opus-5-5",
    taggingBatchSize: Math.min(60, Math.floor(num(env.HOOKLAB_TAGGING_BATCH, 40, 1))),
    taggingMaxBatches: Math.floor(num(env.HOOKLAB_TAGGING_MAX_BATCHES, 3)),
    /** ScrapeCreators credits the pipeline may spend per rolling 24 hours. */
    scrapeCreatorsDailyCredits: Math.floor(num(env.SCRAPECREATORS_DAILY_CREDITS, 100)),
    /** Duration lookups (one channel-videos call per channel) per run. */
    enrichMaxCalls: Math.floor(num(env.HOOKLAB_ENRICH_MAX_CALLS, 15)),
    /** Free watch-page duration lookups per run when credits are out. */
    enrichMaxPages: Math.floor(num(env.HOOKLAB_ENRICH_MAX_PAGES, 20)),
  };
}

export type IngestSettings = ReturnType<typeof ingestSettings>;

export const OUTLIER_THRESHOLD = 2;
/** Crossings on videos older than this aren't counted as "new outliers" (backfills, slow burners). */
export const NEW_OUTLIER_MAX_AGE_DAYS = 30;
/** Fewest earlier videos a pipeline-inserted video must be compared with to get a score. */
export const MIN_COMPARED = 3;
