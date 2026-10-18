// Library totals and breakdowns for `hooklab stats` and GET /api/v1/stats (cached per library state).
import type { DatabaseSync } from "node:sqlite";
import { channelIndex } from "./channel-index.ts";
import { cached, countOf, libraryDb, metaValues, totalVideos } from "./library.ts";
import { CLICK_TRIGGERS, NICHES, TIERS, titleFormatForFrame } from "./taxonomy.ts";

export type RefreshSummary = {
  runs: number;
  lastRunId: number | null;
  lastStartedAt: string | null;
  lastFinishedAt: string | null;
  lastStatus: string | null;
  lastNewVideos: number | null;
  lastNewOutliers: number | null;
};

export type LibraryStats = {
  totals: {
    videos: number;
    channels: number;
    trackedChannels: number;
    shorts: number;
    longform: number;
    publishedLast7Days: number;
    publishedLast30Days: number;
  };
  dateRange: { oldest: string | null; newest: string | null };
  byTier: { id: string; label: string; scoreLabel: string; count: number }[];
  unscored: number;
  bySource: { source: string; count: number }[];
  byTitleFormat: { titleFormat: string | null; frame: string | null; count: number }[];
  byNiche: { niche: string; count: number; inTaxonomy: boolean }[];
  byTrigger: { trigger: string; count: number; inTaxonomy: boolean }[];
  /** When the library file was last rebuilt from the export (meta.built_at). */
  builtAt: string | null;
  /** When the last refresh run finished (meta.last_refresh_at), else the rebuild time. */
  lastRefreshAt: string | null;
  refresh: RefreshSummary | null;
  meta: Record<string, string>;
  generatedAt: string;
};

function hasTable(db: DatabaseSync, name: string): boolean {
  return !!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name);
}

function refreshSummary(db: DatabaseSync): RefreshSummary | null {
  if (!hasTable(db, "refresh_runs")) return null;
  try {
    const runs = countOf(db, "SELECT count(*) AS n FROM refresh_runs");
    const last = db.prepare("SELECT * FROM refresh_runs ORDER BY started_at DESC LIMIT 1").get() as Record<string, unknown> | undefined;
    const num = (v: unknown) => (typeof v === "number" ? v : v == null ? null : Number(v));
    const str = (v: unknown) => (v == null ? null : String(v));
    return {
      runs,
      lastRunId: num(last?.id),
      lastStartedAt: str(last?.started_at),
      lastFinishedAt: str(last?.finished_at),
      lastStatus: str(last?.status),
      lastNewVideos: num(last?.new_videos),
      lastNewOutliers: num(last?.new_outliers),
    };
  } catch {
    return null;
  }
}

/** The refresh pipeline stamps meta.last_refresh_at when a run finishes; older libraries only have runs. */
function lastCompletedRefresh(db: DatabaseSync, meta: Record<string, string>): string | null {
  if (meta.last_refresh_at) return meta.last_refresh_at;
  if (!hasTable(db, "refresh_runs")) return null;
  try {
    const row = db
      .prepare("SELECT max(finished_at) AS t FROM refresh_runs WHERE finished_at IS NOT NULL AND coalesce(dry_run, 0) = 0 AND status IN ('ok', 'partial')")
      .get() as { t: string | null } | undefined;
    return row?.t ?? null;
  } catch {
    return null;
  }
}

function compute(db: DatabaseSync): LibraryStats {
  const now = Date.now();
  const total = totalVideos(db);
  const shorts = countOf(db, "SELECT count(*) AS n FROM videos WHERE is_short = 1");
  const since = (days: number) => countOf(db, "SELECT count(*) AS n FROM videos WHERE publish_at >= ?", [new Date(now - days * 86_400_000).toISOString()]);
  const oldest = (db.prepare("SELECT min(publish_at) AS t FROM videos").get() as { t: string | null }).t;
  const newest = (db.prepare("SELECT max(publish_at) AS t FROM videos").get() as { t: string | null }).t;

  const byTier = TIERS.map((t) => ({
    id: t.id,
    label: t.label,
    scoreLabel: t.scoreLabel,
    count:
      t.max == null
        ? countOf(db, "SELECT count(*) AS n FROM videos WHERE outlier_score >= ?", [t.min])
        : countOf(db, "SELECT count(*) AS n FROM videos WHERE outlier_score >= ? AND outlier_score < ?", [t.min, t.max]),
  }));
  const unscored = countOf(db, "SELECT count(*) AS n FROM videos WHERE outlier_score IS NULL");

  const bySource = (db.prepare("SELECT coalesce(source, 'export') AS source, count(*) AS count FROM videos GROUP BY 1 ORDER BY 2 DESC").all() as {
    source: string;
    count: number;
  }[]).map((r) => ({ source: r.source, count: Number(r.count) }));

  const frames = db.prepare("SELECT frame, count(*) AS count FROM videos GROUP BY frame ORDER BY 2 DESC").all() as { frame: string | null; count: number }[];
  const formatCounts = new Map<string | null, { frame: string | null; count: number }>();
  for (const f of frames) {
    const name = titleFormatForFrame(f.frame);
    const prev = formatCounts.get(name);
    formatCounts.set(name, { frame: name ? f.frame : null, count: (prev?.count ?? 0) + Number(f.count) });
  }
  const byTitleFormat = [...formatCounts.entries()]
    .map(([titleFormat, v]) => ({ titleFormat, frame: v.frame, count: v.count }))
    .sort((a, b) => (a.titleFormat == null ? 1 : b.titleFormat == null ? -1 : b.count - a.count));

  const niches = new Set(NICHES);
  const byNiche = (db.prepare("SELECT niche, count(*) AS count FROM video_niches GROUP BY niche ORDER BY 2 DESC, 1").all() as {
    niche: string;
    count: number;
  }[]).map((r) => ({ niche: r.niche, count: Number(r.count), inTaxonomy: niches.has(r.niche) }));
  const triggers = new Set(CLICK_TRIGGERS);
  const byTrigger = (db
    .prepare("SELECT click_trigger AS trigger, count(*) AS count FROM video_click_triggers GROUP BY click_trigger ORDER BY 2 DESC, 1")
    .all() as { trigger: string; count: number }[]).map((r) => ({ trigger: r.trigger, count: Number(r.count), inTaxonomy: triggers.has(r.trigger) }));

  const channels = channelIndex(db).list;
  const meta = metaValues(db);
  const builtAt = meta.built_at ?? null;
  return {
    totals: {
      videos: total,
      channels: channels.filter((c) => c.videoCount > 0).length,
      trackedChannels: channels.filter((c) => c.tracked).length,
      shorts,
      longform: total - shorts,
      publishedLast7Days: since(7),
      publishedLast30Days: since(30),
    },
    dateRange: { oldest, newest },
    byTier,
    unscored,
    bySource,
    byTitleFormat,
    byNiche,
    byTrigger,
    builtAt,
    lastRefreshAt: lastCompletedRefresh(db, meta) ?? builtAt,
    refresh: refreshSummary(db),
    meta,
    generatedAt: new Date(now).toISOString(),
  };
}

export function libraryStats(): LibraryStats {
  const db = libraryDb();
  return cached(db, "stats", 60_000, () => compute(db));
}

/** Cheap headline numbers (GET /api/v1 index). */
export function libraryCounts(): { videos: number; channels: number; trackedChannels: number; builtAt: string | null; lastRefreshAt: string | null } {
  const db = libraryDb();
  const channels = channelIndex(db).list;
  const meta = metaValues(db);
  return {
    videos: totalVideos(db),
    channels: channels.filter((c) => c.videoCount > 0).length,
    trackedChannels: channels.filter((c) => c.tracked).length,
    builtAt: meta.built_at ?? null,
    lastRefreshAt: lastCompletedRefresh(db, meta) ?? meta.built_at ?? null,
  };
}
