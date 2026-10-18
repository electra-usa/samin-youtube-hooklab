import "server-only";
import { library } from "@/lib/db/library";
import { compactViews, outlierLabel } from "./format";
import type { VideoMap, VideoRef } from "./types";

// "Deep research": full-text search over the outlier library (videos_fts), ranked by
// relevance and outlier score, plus trigger/niche statistics. Everything the model may cite
// comes from these rows, which is how replies stay grounded in real numbers.

export type ResearchVideo = {
  ref: string;
  videoId: string;
  title: string;
  channelId: string | null;
  channelName: string;
  subscriberCount: number | null;
  views: number;
  outlierScore: number;
  publishAt: string | null;
  niches: string[];
  clickTriggers: string[];
  frame: string | null;
  pov: string | null;
};

export type ResearchStat = { ref: string; text: string };

export type Research = {
  queries: string[];
  videos: ResearchVideo[];
  stats: ResearchStat[];
  matched: number;
};

type Row = {
  rowid: number;
  video_id: string;
  title: string;
  channel_id: string | null;
  channel_name: string | null;
  subscriber_count: number | null;
  views: number | null;
  outlier_score: number | null;
  publish_at: string | null;
  niches: string | null;
  click_triggers: string | null;
  frame: string | null;
  pov: string | null;
};

const COLUMNS = `v.rowid AS rowid, v.video_id, v.title, v.channel_id, v.channel_name, v.subscriber_count, v.views,
  v.outlier_score, v.publish_at, v.niches, v.click_triggers, v.frame, v.pov`;

const STOPWORDS = new Set(
  "a an and are as at be but by for from how i in into is it its my of on or so that the this to was we what when why with you your".split(" "),
);

const arr = (s: string | null): string[] => {
  if (!s) return [];
  try {
    const v = JSON.parse(s);
    return Array.isArray(v) ? v.map(String) : [];
  } catch {
    return [];
  }
};

function toVideo(r: Row, ref = ""): ResearchVideo {
  return {
    ref,
    videoId: r.video_id,
    title: r.title,
    channelId: r.channel_id,
    channelName: r.channel_name ?? "Unknown channel",
    subscriberCount: r.subscriber_count,
    views: Number(r.views) || 0,
    outlierScore: Number(r.outlier_score) || 0,
    publishAt: r.publish_at,
    niches: arr(r.niches),
    clickTriggers: arr(r.click_triggers),
    frame: r.frame,
    pov: r.pov,
  };
}

/** FTS5 terms for a free-text query, quoted so user text can't inject query syntax. */
function ftsTerms(query: string): string[] {
  return query
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s']/gu, " ")
    .split(/\s+/)
    .map((t) => t.replace(/'/g, ""))
    .filter((t) => t.length > 1 && !STOPWORDS.has(t))
    .slice(0, 6);
}

function ftsSearch(match: string, limit: number): Row[] {
  try {
    return library()
      .prepare(
        `SELECT ${COLUMNS} FROM (SELECT rowid AS fid, bm25(videos_fts, 3.0, 1.0) AS rank FROM videos_fts
           WHERE videos_fts MATCH ? ORDER BY rank LIMIT ?) f
         JOIN videos v ON v.rowid = f.fid ORDER BY f.rank`,
      )
      .all(match, limit) as Row[];
  } catch {
    return [];
  }
}

const median = (xs: number[]) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

const monthsAgo = (n: number) => {
  const d = new Date();
  d.setMonth(d.getMonth() - n);
  return d.toISOString();
};

/** Search the library for a topic described by several short keyword queries. */
export function researchTopic(args: { queries: string[]; niches?: string[]; limit?: number; excludeIds?: Set<string> }): Research {
  const limit = args.limit ?? 40;
  const queries = [...new Set(args.queries.map((q) => q.trim()).filter(Boolean))].slice(0, 8);
  const hits = new Map<string, { row: Row; relevance: number }>();
  const add = (rows: Row[], weight: number) => {
    rows.forEach((row, i) => {
      const r = weight * (1 - i / Math.max(rows.length, 1)) + weight * 0.25;
      const prev = hits.get(row.video_id);
      if (prev) prev.relevance += r;
      else hits.set(row.video_id, { row, relevance: r });
    });
  };

  for (const q of queries) {
    const terms = ftsTerms(q);
    if (!terms.length) continue;
    const all = ftsSearch(terms.map((t) => `"${t}"`).join(" "), 120);
    add(all, 1);
    if (all.length < 15 && terms.length > 1) add(ftsSearch(terms.map((t) => `"${t}"`).join(" OR "), 80), 0.35);
  }

  const recentCutoff = monthsAgo(12);
  const niches = new Set(args.niches ?? []);
  const scored = [...hits.values()]
    .filter(({ row }) => !args.excludeIds?.has(row.video_id))
    .map(({ row, relevance }) => {
      const v = toVideo(row);
      const perf = Math.log2(1 + Math.min(v.outlierScore, 100));
      const recency = v.publishAt && v.publishAt >= recentCutoff ? 0.35 : 0;
      const nicheFit = v.niches.some((n) => niches.has(n)) ? 0.2 : 0;
      return { v, score: relevance * 2 + perf * 0.6 + recency + nicheFit };
    });

  const strong = scored.filter((s) => s.v.outlierScore >= 1.5 && s.v.views >= 3000);
  const pool = strong.length >= 12 ? strong : scored;
  const videos = pool
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((s, i) => ({ ...s.v, ref: `V${i + 1}` }));

  const matchedVideos = scored.map((s) => s.v);
  return { queries, videos, stats: topicStats(matchedVideos, args.niches ?? []), matched: hits.size };
}

function topicStats(matched: ResearchVideo[], niches: string[]): ResearchStat[] {
  const stats: string[] = [];
  const performers = matched.filter((v) => v.outlierScore >= 2);
  if (matched.length) {
    stats.push(
      `${matched.length} library videos match this topic and ${performers.length} of them are 2x+ outliers (median ${median(matched.map((v) => v.outlierScore)).toFixed(1)}x across all matches).`,
    );
  }
  const byTrigger = new Map<string, number[]>();
  for (const v of performers) for (const t of v.clickTriggers) byTrigger.set(t, [...(byTrigger.get(t) ?? []), v.outlierScore]);
  [...byTrigger.entries()]
    .filter(([, xs]) => xs.length >= 3)
    .sort((a, b) => b[1].length - a[1].length)
    .slice(0, 6)
    .forEach(([t, xs]) => stats.push(`the "${t}" click trigger appears on ${xs.length} of the ${performers.length} matching 2x+ outliers (median ${median(xs).toFixed(1)}x).`));
  const byFrame = new Map<string, number[]>();
  for (const v of performers) if (v.frame) byFrame.set(v.frame, [...(byFrame.get(v.frame) ?? []), v.outlierScore]);
  [...byFrame.entries()]
    .sort((a, b) => b[1].length - a[1].length)
    .slice(0, 3)
    .forEach(([f, xs]) => stats.push(`the "${f}" format accounts for ${xs.length} of the matching 2x+ outliers (median ${median(xs).toFixed(1)}x).`));
  stats.push(...nicheTriggerStats(niches, 6));
  return stats.map((text, i) => ({ ref: `S${i + 1}`, text }));
}

/** Best-performing click triggers in the creator's niches over the last six months. */
export function nicheTriggerStats(niches: string[], months: number): string[] {
  if (!niches.length) return [];
  const placeholders = niches.map(() => "?").join(",");
  try {
    const rows = library()
      .prepare(
        `SELECT t.click_trigger AS trigger, count(DISTINCT v.video_id) AS n, avg(v.outlier_score) AS avg
         FROM video_click_triggers t JOIN videos v ON v.id = t.video_row_id
         JOIN video_niches n ON n.video_row_id = v.id
         WHERE n.niche IN (${placeholders}) AND v.publish_at >= ? AND v.outlier_score >= 2
         GROUP BY t.click_trigger HAVING n >= 15 ORDER BY n DESC LIMIT 5`,
      )
      .all(...niches, monthsAgo(months)) as { trigger: string; n: number; avg: number }[];
    return rows.map(
      (r) => `the "${r.trigger}" click trigger appears on ${r.n} 2x+ outliers in ${niches.join(" / ")} from the last ${months} months (average ${Number(r.avg).toFixed(1)}x).`,
    );
  } catch {
    return [];
  }
}

/** Recent top outliers in the creator's niches ("what's working now"). */
export function nicheOutliers(args: { niches: string[]; days: number; limit: number; excludedNiches?: string[]; excludeChannelId?: string | null }): ResearchVideo[] {
  const since = new Date(Date.now() - args.days * 86_400_000).toISOString();
  const params: (string | number)[] = [since];
  let nicheClause = "";
  if (args.niches.length) {
    nicheClause = `AND v.id IN (SELECT video_row_id FROM video_niches WHERE niche IN (${args.niches.map(() => "?").join(",")}))`;
    params.push(...args.niches);
  }
  let excludeClause = "";
  if (args.excludedNiches?.length) {
    excludeClause = `AND v.id NOT IN (SELECT video_row_id FROM video_niches WHERE niche IN (${args.excludedNiches.map(() => "?").join(",")}))`;
    params.push(...args.excludedNiches);
  }
  if (args.excludeChannelId) params.push(args.excludeChannelId);
  params.push(args.limit);
  const rows = library()
    .prepare(
      `SELECT ${COLUMNS} FROM videos v WHERE v.publish_at >= ? ${nicheClause} ${excludeClause}
       ${args.excludeChannelId ? "AND (v.channel_id IS NULL OR v.channel_id != ?)" : ""}
       AND v.views >= 5000 ORDER BY v.outlier_score DESC LIMIT ?`,
    )
    .all(...params) as Row[];
  return rows.map((r) => toVideo(r));
}

/** Top recent videos from specific channels (the creator's followed lists). */
export function channelOutliers(channelIds: string[], limit: number): ResearchVideo[] {
  if (!channelIds.length) return [];
  const rows = library()
    .prepare(
      `SELECT ${COLUMNS} FROM videos v WHERE v.channel_id IN (${channelIds.map(() => "?").join(",")})
       AND v.publish_at >= ? ORDER BY v.outlier_score DESC LIMIT ?`,
    )
    .all(...channelIds, monthsAgo(6), limit) as Row[];
  return rows.map((r) => toVideo(r));
}

export type ChannelCandidate = {
  ref: string;
  channelId: string;
  channelName: string;
  subscriberCount: number | null;
  outliers: number;
  medianOutlier: number;
  bestTitle: string;
  bestVideoId: string;
  bestOutlier: number;
  niches: string[];
};

/** Channels with repeated recent outliers in the given niches, for "who should I study". */
export function channelCandidates(args: { niches: string[]; excludeChannelIds: string[]; limit: number; inNiche: boolean }): ChannelCandidate[] {
  const params: (string | number)[] = [monthsAgo(6)];
  let clause = "";
  if (args.niches.length) {
    clause = `AND v.id ${args.inNiche ? "IN" : "NOT IN"} (SELECT video_row_id FROM video_niches WHERE niche IN (${args.niches.map(() => "?").join(",")}))`;
    params.push(...args.niches);
  }
  const rows = library()
    .prepare(
      `SELECT ${COLUMNS} FROM videos v WHERE v.publish_at >= ? ${clause} AND v.outlier_score >= 3 AND v.channel_id IS NOT NULL
       ORDER BY v.outlier_score DESC LIMIT 3000`,
    )
    .all(...params) as Row[];
  const exclude = new Set(args.excludeChannelIds);
  const byChannel = new Map<string, ResearchVideo[]>();
  for (const r of rows) {
    if (!r.channel_id || exclude.has(r.channel_id)) continue;
    byChannel.set(r.channel_id, [...(byChannel.get(r.channel_id) ?? []), toVideo(r)]);
  }
  return [...byChannel.entries()]
    .filter(([, vs]) => vs.length >= 2)
    .map(([channelId, vs]) => {
      const best = vs[0];
      const niches = [...new Set(vs.flatMap((v) => v.niches))].slice(0, 3);
      return {
        ref: "",
        channelId,
        channelName: best.channelName,
        subscriberCount: best.subscriberCount,
        outliers: vs.length,
        medianOutlier: median(vs.map((v) => v.outlierScore)),
        bestTitle: best.title,
        bestVideoId: best.videoId,
        bestOutlier: best.outlierScore,
        niches,
      };
    })
    .sort((a, b) => b.outliers * Math.log2(1 + b.medianOutlier) - a.outliers * Math.log2(1 + a.medianOutlier))
    .slice(0, args.limit)
    .map((c, i) => ({ ...c, ref: `C${i + 1}` }));
}

export function lookupVideos(ids: string[]): Map<string, ResearchVideo> {
  const out = new Map<string, ResearchVideo>();
  const unique = [...new Set(ids.filter(Boolean))].slice(0, 200);
  if (!unique.length) return out;
  const rows = library()
    .prepare(`SELECT ${COLUMNS} FROM videos v WHERE v.video_id IN (${unique.map(() => "?").join(",")})`)
    .all(...unique) as Row[];
  for (const r of rows) out.set(r.video_id, toVideo(r));
  return out;
}

/** Which of these channel ids exist in the library. */
export function knownChannelIds(ids: string[]): Set<string> {
  const unique = [...new Set(ids.filter(Boolean))].slice(0, 100);
  if (!unique.length) return new Set();
  const rows = library()
    .prepare(`SELECT channel_id FROM channels WHERE channel_id IN (${unique.map(() => "?").join(",")})`)
    .all(...unique) as { channel_id: string }[];
  return new Set(rows.map((r) => r.channel_id));
}

export function toVideoRef(v: ResearchVideo): VideoRef {
  return {
    title: v.title,
    views: compactViews(v.views),
    outlierScore: outlierLabel(v.outlierScore),
    channelName: v.channelName,
    videoId: v.videoId,
    publishedAt: v.publishAt,
  };
}

export function addToVideoMap(map: VideoMap, v: ResearchVideo) {
  map[v.title.trim().toLowerCase()] = toVideoRef(v);
}

const day = (iso: string | null) => (iso ? iso.slice(0, 10) : "?");

/** Prompt rows for research videos; the model cites them by videoId. */
export function renderVideos(videos: ResearchVideo[]): string {
  return videos
    .map(
      (v) =>
        `[${v.ref || v.videoId}] videoId=${v.videoId} | "${v.title}" | ${v.channelName}` +
        `${v.subscriberCount ? ` (${compactViews(v.subscriberCount)} subs)` : ""} | ${compactViews(v.views)} views | ${outlierLabel(v.outlierScore)} | ${day(v.publishAt)}` +
        `${v.clickTriggers.length ? ` | triggers: ${v.clickTriggers.join(", ")}` : ""}${v.frame ? ` | format: ${v.frame}` : ""}`,
    )
    .join("\n");
}

export function renderStats(stats: ResearchStat[]): string {
  return stats.map((s) => `[${s.ref}] ${s.text}`).join("\n");
}
