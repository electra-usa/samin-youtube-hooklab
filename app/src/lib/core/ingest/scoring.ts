// Outlier scores for live videos. Same rule as Creator Hooks (reverse-engineered in
// src/lib/channel/outliers.ts and checked against the exported library, where it reproduces
// the stored scores): a video's views divided by the rounded mean views of the up-to-10
// videos of the same kind (long-form or Shorts) the channel published just before it.
import { COMPARISON_WINDOW, computeComparisons } from "../../channel/outliers.ts";
import { OUTLIER_THRESHOLD } from "./settings.ts";

// Same bands as scripts/private/build-db.py and src/lib/taxonomy.json (performance_tiers).
const TIERS: [string, number, number][] = [
  ["flops", 0, 0.3],
  ["below_avg", 0.3, 1],
  ["pretty_good", 1, 2],
  ["above_avg", 2, 4],
  ["great", 4, 10],
  ["bangers", 10, 50],
  ["mega_bangers", 50, Number.POSITIVE_INFINITY],
];

export function tierFor(score: number | null | undefined): string | null {
  if (score == null || !Number.isFinite(score)) return null;
  return TIERS.find(([, lo, hi]) => score >= lo && score < hi)?.[0] ?? null;
}

export const isOutlier = (score: number | null | undefined) => score != null && score >= OUTLIER_THRESHOLD;

export type HistoryVideo = {
  videoId: string;
  views: number;
  publishedAt: string | null;
  /** Seen in a feed by the pipeline (feeds list every upload, so observed history has no gaps). */
  observed: boolean;
};

export type WindowScore = {
  score: number | null;
  baselineViews: number | null;
  compared: number;
  /** Every video in the window was observed in a feed (vs. filled in from export rows). */
  observedWindow: boolean;
};

/** Order used by computeComparisons: publish time, then video id. */
const byPublish = (a: HistoryVideo, b: HistoryVideo) =>
  (a.publishedAt ?? "").localeCompare(b.publishedAt ?? "") || a.videoId.localeCompare(b.videoId);

/** Score `targets` against the channel history of one kind. */
export function scoreAgainstHistory(history: HistoryVideo[], targets: Iterable<string>): Map<string, WindowScore> {
  const comparisons = computeComparisons(history.map((h) => ({ videoId: h.videoId, views: h.views, publishedAt: h.publishedAt })));
  const sorted = [...history].sort(byPublish);
  const position = new Map(sorted.map((h, i) => [h.videoId, i]));
  const views = new Map(history.map((h) => [h.videoId, h.views]));
  const out = new Map<string, WindowScore>();
  for (const id of targets) {
    const c = comparisons.get(id);
    const i = position.get(id);
    if (!c || i == null) {
      out.set(id, { score: null, baselineViews: null, compared: 0, observedWindow: false });
      continue;
    }
    const window = sorted.slice(Math.max(0, i - COMPARISON_WINDOW), i);
    out.set(id, {
      score: (views.get(id) ?? 0) / c.avgViews,
      baselineViews: c.avgViews,
      compared: c.totalCompared,
      observedWindow: window.every((w) => w.observed),
    });
  }
  return out;
}

/**
 * Export rows of channels whose export so far holds mostly outliers (the exporter fetched 2x+
 * videos first) would inflate the window; only trust them when enough are below 2x.
 */
export function trustExportHistory(exportRows: number, exportBelow2x: number): boolean {
  return exportRows === 0 || exportBelow2x / exportRows >= 0.3;
}
