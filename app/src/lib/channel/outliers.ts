// "vs. your recent average" comparison for your own videos, reverse-engineered from
// the account export (data/account/my-channel-videos-*.json; 303/303 rows reproduce):
// - window: the up-to-10 videos of the same kind published just before this one
// - avgViews: Math.round(mean views of that window), the video itself excluded
// - multiplier: views / avgViews rounded half-up to one decimal, as a string ("1.1")
// - rank: 1 + window videos with strictly more views, capped at the window size
// - totalCompared: window size; the oldest video of each kind has no comparison
// isTrueOutOfTen was false on every exported row; its meaning is unknown.

export const COMPARISON_WINDOW = 10;

export type Comparison = {
  avgViews: number;
  multiplier: string;
  rank: number;
  totalCompared: number;
  isTrueOutOfTen: boolean;
};

type ComparableVideo = { videoId: string; views: number; publishedAt: string | null };

export function computeComparisons(videos: ComparableVideo[]): Map<string, Comparison | null> {
  const sorted = [...videos].sort(
    (a, b) => (a.publishedAt ?? "").localeCompare(b.publishedAt ?? "") || a.videoId.localeCompare(b.videoId),
  );
  const out = new Map<string, Comparison | null>();
  sorted.forEach((v, i) => {
    const window = sorted.slice(Math.max(0, i - COMPARISON_WINDOW), i);
    if (!window.length) {
      out.set(v.videoId, null);
      return;
    }
    const avgViews = Math.round(window.reduce((s, w) => s + (w.views || 0), 0) / window.length);
    if (avgViews <= 0) {
      out.set(v.videoId, null);
      return;
    }
    const better = window.filter((w) => (w.views || 0) > (v.views || 0)).length;
    out.set(v.videoId, {
      avgViews,
      multiplier: (Math.round(((v.views || 0) * 10) / avgViews) / 10).toFixed(1),
      rank: Math.min(better + 1, window.length),
      totalCompared: window.length,
      isTrueOutOfTen: false,
    });
  });
  return out;
}
