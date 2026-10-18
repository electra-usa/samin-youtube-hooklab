// Video search over the library (data/library.db), shared by the `hooklab` CLI and /api/v1.
//
// Pagination is keyset-based: rows are ordered by (sort key DESC, id DESC) and a cursor holds
// the last row's key, so pages stay stable while the refresh pipeline inserts videos.
// Each query walks exactly one index: the sort index by default, or the index of a filter that
// is far more selective (a channel, a small niche, shorts only, a narrow date range...). Other
// indexable predicates are written as `+column` so SQLite can't pick a worse plan.
import type { DatabaseSync, SQLInputValue } from "node:sqlite";
import { cursorMismatch, decodeCursor, encodeCursor, queryHash, type CursorKey, type CursorState, type Frozen } from "./cursor.ts";
import { QueryError } from "./errors.ts";
import { resolveChannelFilter } from "./channel-index.ts";
import { cached, countOf, libraryDb, placeholders, totalVideos } from "./library.ts";
import {
  TIERS,
  canonicalNiche,
  canonicalTier,
  canonicalTitleFormat,
  canonicalTrigger,
  framesForFormats,
  tierForScore,
  titleFormatForFrame,
} from "./taxonomy.ts";
import { keywordExpression, titleTerm, topicPhrase, topicTerms } from "./text.ts";
import { asList, asString, parseAmount, parseBoolean, parseDateBound, parseEnum, parseInteger, type ParamValue } from "./values.ts";

// ------------------------------------------------------------------ public types

export type SearchMode = "topic" | "keyword";
export type VideoSort = "relevance" | "newest" | "outlier" | "views" | "subscribers";
export type ShortsFilter = "include" | "only" | "exclude";

export const SEARCH_MODES: SearchMode[] = ["topic", "keyword"];
export const VIDEO_SORTS: VideoSort[] = ["relevance", "newest", "outlier", "views", "subscribers"];
export const SHORTS_FILTERS: ShortsFilter[] = ["include", "only", "exclude"];
export const MAX_LIMIT = 1000;
export const DEFAULT_LIMIT = 50;

/** Every filter accepts a string (URL query, CLI flag), a number, or a list where it makes sense. */
export type VideoSearchInput = {
  /** Search text (titles only). */
  q?: ParamValue;
  /** topic (default): any stemmed term, ranked by relevance. keyword: every word must appear. */
  mode?: ParamValue;
  minOutlier?: ParamValue;
  maxOutlier?: ParamValue;
  /** Tier ids or labels: flops, below_avg, pretty_good, above_avg, great, bangers, mega_bangers. */
  tier?: ParamValue;
  minViews?: ParamValue;
  maxViews?: ParamValue;
  minSubs?: ParamValue;
  maxSubs?: ParamValue;
  /** Any of these niches. */
  niche?: ParamValue;
  excludeNiche?: ParamValue;
  /** Any of these click triggers. */
  trigger?: ParamValue;
  excludeTrigger?: ParamValue;
  /** Title formats (Challenge, Tutorial, Explainer, List, Story, Review, Reaction) or their frames. */
  format?: ParamValue;
  /** Channel ids, @handles, channel URLs or exact channel names. */
  channelId?: ParamValue;
  /** Published at or after: ISO date/timestamp or an age like 7d, 3m, 1y. */
  since?: ParamValue;
  /** Published before (a date-only value includes that whole day). */
  until?: ParamValue;
  shorts?: ParamValue;
  /** Row origin: export, rss, … */
  source?: ParamValue;
  sort?: ParamValue;
  limit?: ParamValue;
  cursor?: ParamValue;
  /** Output fields (see VIDEO_FIELDS); default all. */
  fields?: ParamValue;
  /** Also return the total number of matches. */
  count?: ParamValue;
};

/** Parameter names accepted by searchVideos (and as query parameters by GET /api/v1/videos). */
export const VIDEO_QUERY_PARAMS = [
  "q", "mode", "minOutlier", "maxOutlier", "tier", "minViews", "maxViews", "minSubs", "maxSubs",
  "niche", "excludeNiche", "trigger", "excludeTrigger", "format", "channelId", "since", "until",
  "shorts", "source", "sort", "limit", "cursor", "fields", "count",
] as const;

/** Video as returned by the CLI and API: the library row shape (see toOutlierVideo) plus tier, title format and source. */
export type VideoRecord = {
  id: string;
  videoId: string;
  title: string;
  titleLength: number | null;
  videoUrl: string;
  thumbnail: string;
  channelId: string | null;
  channelName: string | null;
  subscriberCount: number | null;
  views: number | null;
  outlierScore: number | null;
  tier: string | null;
  publishAt: string | null;
  duration: string | null;
  durationSeconds: number | null;
  isShort: boolean;
  frame: string | null;
  secondaryFrame: string | null;
  titleFormat: string | null;
  pov: string | null;
  niches: string[];
  clickTriggers: string[];
  videoTypes: string[];
  featuredInNewsletter: boolean;
  source: string;
  /** Topic searches only: the relevance score the results are ranked by. */
  relevance?: number;
};

export const VIDEO_FIELDS = [
  "id", "videoId", "title", "titleLength", "videoUrl", "thumbnail", "channelId", "channelName", "subscriberCount",
  "views", "outlierScore", "tier", "publishAt", "duration", "durationSeconds", "isShort", "frame", "secondaryFrame",
  "titleFormat", "pov", "niches", "clickTriggers", "videoTypes", "featuredInNewsletter", "source",
] as const satisfies readonly (keyof VideoRecord)[];

export type VideoField = keyof VideoRecord;

export type VideoPage = {
  data: Partial<VideoRecord>[];
  nextCursor: string | null;
  hasMore: boolean;
  /** Present when `count` was requested. */
  total?: number;
  sort: VideoSort;
  mode: SearchMode | null;
};

/** Normalized, validated query. */
export type VideoQuery = {
  q: string | null;
  mode: SearchMode;
  /** Outlier score constraint as ranges (tiers are [min, max); maxOutlier is inclusive). Null = none. */
  outlierRanges: { min: number | null; max: number | null; maxInclusive: boolean }[] | null;
  minViews: number | null;
  maxViews: number | null;
  minSubs: number | null;
  maxSubs: number | null;
  niches: string[];
  excludeNiches: string[];
  triggers: string[];
  excludeTriggers: string[];
  formats: string[];
  channelIds: string[];
  since: string | null;
  until: string | null;
  shorts: ShortsFilter;
  sources: string[];
  sort: VideoSort;
  limit: number;
  cursor: string | null;
  fields: VideoField[] | null;
  count: boolean;
  /** Echo of the raw inputs that define the result set (for the cursor hash). */
  identity: Record<string, unknown>;
};

// ------------------------------------------------------------------ normalization

const bad = (message: string, code = "invalid_parameter") => new QueryError(message, { code });

const SORT_ALIASES: Record<string, VideoSort> = {
  relevance: "relevance", relevant: "relevance", best: "relevance",
  newest: "newest", new: "newest", recent: "newest", date: "newest", latest: "newest",
  outlier: "outlier", outliers: "outlier", score: "outlier", outlierscore: "outlier",
  views: "views", view: "views", popular: "views",
  subscribers: "subscribers", subs: "subscribers", subscriber: "subscribers",
};

function stripX(value: ParamValue): ParamValue {
  return typeof value === "string" ? value.replace(/x$/i, "") : value;
}

function existingValue(db: DatabaseSync, table: "video_niches" | "video_click_triggers", value: string): boolean {
  const col = table === "video_niches" ? "niche" : "click_trigger";
  return !!db.prepare(`SELECT 1 FROM ${table} WHERE ${col} = ? LIMIT 1`).get(value);
}

/** Taxonomy names first; exact values that only exist in the data (e.g. "Architecture") also pass. */
function canonList(db: DatabaseSync, values: string[], canon: (v: string) => string, table: "video_niches" | "video_click_triggers"): string[] {
  return [
    ...new Set(
      values.map((v) => {
        try {
          return canon(v);
        } catch (err) {
          if (existingValue(db, table, v)) return v;
          throw err;
        }
      }),
    ),
  ];
}

type OutlierRange = { min: number | null; max: number | null; maxInclusive: boolean };

/** Tiers merge into contiguous score ranges, intersected with min/max. Null = no constraint; [] = nothing can match. */
function rangesFor(tiers: string[], minOutlier: number | null, maxOutlier: number | null): OutlierRange[] | null {
  const base: OutlierRange[] = [];
  for (const t of TIERS.filter((t) => tiers.includes(t.id))) {
    const last = base[base.length - 1];
    if (last && last.max != null && last.max === t.min) last.max = t.max;
    else base.push({ min: t.min, max: t.max, maxInclusive: false });
  }
  if (!base.length) {
    if (minOutlier == null && maxOutlier == null) return null;
    base.push({ min: null, max: null, maxInclusive: false });
  }
  return base
    .map((r) => {
      const min = minOutlier != null && (r.min == null || minOutlier > r.min) ? minOutlier : r.min;
      const tighter = maxOutlier != null && (r.max == null || maxOutlier < r.max);
      return { min, max: tighter ? maxOutlier : r.max, maxInclusive: tighter ? true : r.maxInclusive };
    })
    .filter((r) => r.min == null || r.max == null || r.min < r.max || (r.maxInclusive && r.min === r.max));
}

export function normalizeVideoQuery(input: VideoSearchInput, db: DatabaseSync = libraryDb()): VideoQuery {
  const q = asString(input.q)?.slice(0, 300) ?? null;
  const mode = parseEnum("mode", input.mode, SEARCH_MODES) ?? "topic";

  const minOutlier = parseAmount("minOutlier", stripX(input.minOutlier));
  const maxOutlier = parseAmount("maxOutlier", stripX(input.maxOutlier));
  if (minOutlier != null && maxOutlier != null && minOutlier > maxOutlier) throw bad("minOutlier can't be greater than maxOutlier.");
  const tiers = [...new Set(asList(input.tier).map(canonicalTier))];
  const outlierRanges = rangesFor(tiers, minOutlier, maxOutlier);

  const minViews = parseAmount("minViews", input.minViews);
  const maxViews = parseAmount("maxViews", input.maxViews);
  if (minViews != null && maxViews != null && minViews > maxViews) throw bad("minViews can't be greater than maxViews.");
  const minSubs = parseAmount("minSubs", input.minSubs);
  const maxSubs = parseAmount("maxSubs", input.maxSubs);
  if (minSubs != null && maxSubs != null && minSubs > maxSubs) throw bad("minSubs can't be greater than maxSubs.");

  const niches = canonList(db, asList(input.niche), canonicalNiche, "video_niches");
  const excludeNiches = canonList(db, asList(input.excludeNiche), canonicalNiche, "video_niches");
  const triggers = canonList(db, asList(input.trigger), canonicalTrigger, "video_click_triggers");
  const excludeTriggers = canonList(db, asList(input.excludeTrigger), canonicalTrigger, "video_click_triggers");
  const formats = [...new Set(asList(input.format).map(canonicalTitleFormat))];
  const channelIds = [...new Set(asList(input.channelId).map((c) => resolveChannelFilter(db, c)))];

  const since = asString(input.since) ?? null;
  const until = asString(input.until) ?? null;
  // Validate now; the resolved bounds are frozen into the cursor on the first page.
  const now = new Date();
  parseDateBound("since", since, "start", now);
  parseDateBound("until", until, "end", now);

  const shorts = parseEnum("shorts", input.shorts, SHORTS_FILTERS) ?? "include";
  const sources = asList(input.source).map((s) => s.toLowerCase());

  const sortRaw = asString(input.sort)?.toLowerCase().replace(/[^a-z]/g, "");
  const sort = sortRaw ? SORT_ALIASES[sortRaw] : q && mode === "topic" ? "relevance" : "newest";
  if (!sort) throw bad(`sort must be one of: ${VIDEO_SORTS.join(", ")} (got "${asString(input.sort)}").`);
  if (sort === "relevance" && !(q && mode === "topic")) throw bad("sort=relevance needs a topic search (q with mode=topic).");

  const limit = parseInteger("limit", input.limit, { min: 1, max: MAX_LIMIT, fallback: DEFAULT_LIMIT, clamp: true });
  const cursor = asString(input.cursor) ?? null;
  const fieldList = asList(input.fields);
  const known = new Set<string>([...VIDEO_FIELDS, "relevance"]);
  const unknownField = fieldList.find((f) => !known.has(f));
  if (unknownField) {
    throw new QueryError(`Unknown field "${unknownField}". Fields: ${[...VIDEO_FIELDS, "relevance"].join(", ")}.`, {
      code: "invalid_parameter",
      details: { allowed: [...VIDEO_FIELDS, "relevance"] },
    });
  }
  const fields = fieldList.length ? (fieldList as VideoField[]) : null;
  const count = parseBoolean("count", input.count) ?? false;

  const identity = {
    q: q?.toLowerCase() ?? null,
    mode: q ? mode : null,
    outlierRanges,
    minViews, maxViews, minSubs, maxSubs,
    niches: [...niches].sort(), excludeNiches: [...excludeNiches].sort(),
    triggers: [...triggers].sort(), excludeTriggers: [...excludeTriggers].sort(),
    formats: [...formats].sort(), channelIds: [...channelIds].sort(),
    since, until, shorts, sources: [...sources].sort(), sort,
  };

  return {
    q, mode, outlierRanges, minViews, maxViews, minSubs, maxSubs, niches, excludeNiches, triggers, excludeTriggers,
    formats, channelIds, since, until, shorts, sources, sort, limit, cursor, fields, count, identity,
  };
}

// ------------------------------------------------------------------ rows

const COLUMN_NAMES = [
  "id", "video_id", "title", "title_length", "video_url", "thumbnail_url", "channel_id", "channel_name", "subscriber_count",
  "views", "outlier_score", "tier", "publish_at", "duration", "duration_seconds", "is_short", "frame", "secondary_frame",
  "pov", "featured_in_newsletter", "niches", "click_triggers", "video_types", "source",
];
const COLUMNS = COLUMN_NAMES.map((c) => `v.${c}`).join(", ");

type Row = {
  id: string;
  video_id: string;
  title: string;
  title_length: number | null;
  video_url: string | null;
  thumbnail_url: string | null;
  channel_id: string | null;
  channel_name: string | null;
  subscriber_count: number | null;
  views: number | null;
  outlier_score: number | null;
  tier: string | null;
  publish_at: string | null;
  duration: string | null;
  duration_seconds: number | null;
  is_short: number | null;
  frame: string | null;
  secondary_frame: string | null;
  pov: string | null;
  featured_in_newsletter: number | null;
  niches: string | null;
  click_triggers: string | null;
  video_types: string | null;
  source: string | null;
  _score?: number;
  _pa?: string;
};

function jsonList(s: string | null): string[] {
  if (!s) return [];
  try {
    const v = JSON.parse(s);
    return Array.isArray(v) ? v.map(String) : [];
  } catch {
    return [];
  }
}

export function toVideoRecord(r: Row): VideoRecord {
  const isShort = !!r.is_short;
  const rec: VideoRecord = {
    id: r.id,
    videoId: r.video_id,
    title: r.title,
    titleLength: r.title_length ?? (r.title ? [...r.title].length : null),
    videoUrl: r.video_url || (isShort ? `https://www.youtube.com/shorts/${r.video_id}` : `https://www.youtube.com/watch?v=${r.video_id}`),
    thumbnail: r.thumbnail_url || `https://i.ytimg.com/vi/${r.video_id}/hqdefault.jpg`,
    channelId: r.channel_id,
    channelName: r.channel_name,
    subscriberCount: r.subscriber_count,
    views: r.views,
    outlierScore: r.outlier_score,
    tier: tierForScore(r.outlier_score)?.id ?? r.tier,
    publishAt: r.publish_at,
    duration: r.duration,
    durationSeconds: r.duration_seconds,
    isShort,
    frame: r.frame,
    secondaryFrame: r.secondary_frame,
    titleFormat: titleFormatForFrame(r.frame) ?? titleFormatForFrame(r.secondary_frame),
    pov: r.pov,
    niches: jsonList(r.niches),
    clickTriggers: jsonList(r.click_triggers),
    videoTypes: jsonList(r.video_types),
    featuredInNewsletter: !!r.featured_in_newsletter,
    source: r.source ?? "export",
  };
  if (r._score != null) rec.relevance = r._score;
  return rec;
}

export function pickFields(rec: VideoRecord, fields: readonly VideoField[] | null): Partial<VideoRecord> {
  if (!fields) return rec;
  const out: Partial<VideoRecord> = {};
  for (const f of fields) (out as Record<string, unknown>)[f] = rec[f] ?? null;
  return out;
}

// ------------------------------------------------------------------ query planning

type Driver = "sort" | "fts" | "channel" | "niche" | "trigger" | "source" | "shorts" | "date" | "outlier" | "views" | "subs";

type SortSpec = { expr: string; nullable: boolean; key: (r: Row) => CursorKey };

const SUBS_EXPR = "coalesce(v.subscriber_count, -1)";
const SORTS: Record<Exclude<VideoSort, "relevance">, SortSpec> = {
  newest: { expr: "v.publish_at", nullable: true, key: (r) => r.publish_at },
  outlier: { expr: "v.outlier_score", nullable: true, key: (r) => r.outlier_score },
  views: { expr: "v.views", nullable: true, key: (r) => r.views },
  subscribers: { expr: SUBS_EXPR, nullable: false, key: (r) => r.subscriber_count ?? -1 },
};

// BM25-style relevance with statistics frozen on the first page: binary term frequency
// (titles rarely repeat words), title length normalization, phrase bonus.
const BM25_K1 = 1.2;
const BM25_B = 0.75;
const AVG_TITLE_LENGTH = 60;
const PHRASE_BOOST = 1.5;
/** A topic match needs at least this share of the query's term weight (or the whole phrase). */
const TOPIC_MIN_SHARE = 0.5;

type Where = { sql: string[]; params: SQLInputValue[] };

function addInstrAny(w: Where, column: string, values: string[]) {
  w.sql.push(`(${values.map(() => `instr(v.${column}, ?) > 0`).join(" OR ")})`);
  w.params.push(...values.map((v) => JSON.stringify(v)));
}

function addInstrNone(w: Where, column: string, values: string[]) {
  w.sql.push(`(v.${column} IS NULL OR (${values.map(() => `instr(v.${column}, ?) = 0`).join(" AND ")}))`);
  w.params.push(...values.map((v) => JSON.stringify(v)));
}

function outlierSql(ranges: VideoQuery["outlierRanges"], col: string): { sql: string; params: SQLInputValue[] } | null {
  if (!ranges) return null;
  if (!ranges.length) return { sql: "0", params: [] };
  const parts: string[] = [];
  const params: SQLInputValue[] = [];
  for (const r of ranges) {
    const p: string[] = [];
    if (r.min != null) {
      p.push(`${col} >= ?`);
      params.push(r.min);
    }
    if (r.max != null) {
      p.push(`${col} ${r.maxInclusive ? "<=" : "<"} ?`);
      params.push(r.max);
    }
    if (!p.length) p.push(`${col} IS NOT NULL`);
    parts.push(p.join(" AND "));
  }
  return { sql: parts.length === 1 ? parts[0] : `(${parts.map((p) => `(${p})`).join(" OR ")})`, params };
}

function outlierSpan(ranges: NonNullable<VideoQuery["outlierRanges"]>): { sql: string; params: SQLInputValue[] } | null {
  const mins = ranges.map((r) => r.min);
  const maxes = ranges.map((r) => r.max);
  const parts: string[] = [];
  const params: SQLInputValue[] = [];
  if (mins.every((m) => m != null)) {
    parts.push("v.outlier_score >= ?");
    params.push(Math.min(...(mins as number[])));
  }
  if (maxes.every((m) => m != null)) {
    parts.push("v.outlier_score <= ?");
    params.push(Math.max(...(maxes as number[])));
  }
  return parts.length ? { sql: parts.join(" AND "), params } : null;
}

/** WHERE predicates for every filter except search text and the keyset. */
function filterWhere(q: VideoQuery, frozen: Frozen, driver: Driver): Where {
  const w: Where = { sql: [], params: [] };
  const usable = (d: Driver, sortKey?: VideoSort) => driver === d || (driver === "sort" && sortKey != null && q.sort === sortKey);
  const col = (name: string, ok: boolean) => (ok ? `v.${name}` : `+v.${name}`);

  const outlierIndexed = usable("outlier", "outlier");
  const outlier = outlierSql(q.outlierRanges, col("outlier_score", outlierIndexed && (q.outlierRanges?.length ?? 0) <= 1));
  if (outlier) {
    w.sql.push(outlier.sql);
    w.params.push(...outlier.params);
  }
  // Several tier ranges: give the index one contiguous span to walk; the exact ranges filter.
  const span = outlierIndexed && q.outlierRanges && q.outlierRanges.length > 1 ? outlierSpan(q.outlierRanges) : null;
  if (span) {
    w.sql.push(span.sql);
    w.params.push(...span.params);
  }
  const views = col("views", usable("views", "views"));
  if (q.minViews != null) {
    w.sql.push(`${views} >= ?`);
    w.params.push(q.minViews);
  }
  if (q.maxViews != null) {
    w.sql.push(`${views} <= ?`);
    w.params.push(q.maxViews);
  }
  if (q.minSubs != null || q.maxSubs != null) {
    const subs = usable("subs", "subscribers") ? SUBS_EXPR : `+${SUBS_EXPR}`;
    w.sql.push(`${subs} >= ?`);
    w.params.push(q.minSubs ?? 0);
    if (q.maxSubs != null) {
      w.sql.push(`${subs} <= ?`);
      w.params.push(q.maxSubs);
    }
  }
  const date = col("publish_at", usable("date", "newest"));
  if (frozen.since) {
    w.sql.push(`${date} >= ?`);
    w.params.push(frozen.since);
  }
  if (frozen.until) {
    w.sql.push(`${date} < ?`);
    w.params.push(frozen.until);
  }
  if (q.shorts === "only") w.sql.push(`${col("is_short", usable("shorts"))} = 1`);
  else if (q.shorts === "exclude") w.sql.push("coalesce(v.is_short, 0) = 0");
  if (q.sources.length) {
    w.sql.push(`${col("source", usable("source"))} IN (${placeholders(q.sources.length)})`);
    w.params.push(...q.sources);
  }
  if (q.channelIds.length) {
    w.sql.push(`${col("channel_id", usable("channel"))} IN (${placeholders(q.channelIds.length)})`);
    w.params.push(...q.channelIds);
  }
  if (q.niches.length) {
    if (driver === "niche") {
      w.sql.push(`v.id IN (SELECT video_row_id FROM video_niches WHERE niche IN (${placeholders(q.niches.length)}))`);
      w.params.push(...q.niches);
    } else addInstrAny(w, "niches", q.niches);
  }
  if (q.triggers.length) {
    if (driver === "trigger") {
      w.sql.push(`v.id IN (SELECT video_row_id FROM video_click_triggers WHERE click_trigger IN (${placeholders(q.triggers.length)}))`);
      w.params.push(...q.triggers);
    } else addInstrAny(w, "click_triggers", q.triggers);
  }
  if (q.excludeNiches.length) addInstrNone(w, "niches", q.excludeNiches);
  if (q.excludeTriggers.length) addInstrNone(w, "click_triggers", q.excludeTriggers);
  const frames = framesForFormats(q.formats);
  if (frames.length) {
    const marks = placeholders(frames.length);
    w.sql.push(`(+v.frame IN (${marks}) OR +v.secondary_frame IN (${marks}))`);
    w.params.push(...frames, ...frames);
  }
  return w;
}

/** Rows matching each indexable filter alone, from its own index (cached per library state, capped at `cap`). */
function candidateCounts(db: DatabaseSync, q: VideoQuery, frozen: Frozen, cap: number): [Driver, number][] {
  const out: [Driver, number][] = [];
  const count = (key: string, sql: string, params: SQLInputValue[]) =>
    cached(db, `count:${key}:${cap}:${JSON.stringify(params)}`, 120_000, () =>
      countOf(db, `SELECT count(*) AS n FROM (${sql.replace("SELECT count(*) AS n FROM", "SELECT 1 FROM")} LIMIT ?)`, [...params, cap]),
    );
  if (q.channelIds.length) {
    out.push(["channel", count("channel", `SELECT count(*) AS n FROM videos WHERE channel_id IN (${placeholders(q.channelIds.length)})`, q.channelIds)]);
  }
  if (q.niches.length) {
    out.push(["niche", count("niche", `SELECT count(*) AS n FROM video_niches WHERE niche IN (${placeholders(q.niches.length)})`, q.niches)]);
  }
  if (q.triggers.length) {
    out.push([
      "trigger",
      count("trigger", `SELECT count(*) AS n FROM video_click_triggers WHERE click_trigger IN (${placeholders(q.triggers.length)})`, q.triggers),
    ]);
  }
  if (q.sources.length) out.push(["source", count("source", `SELECT count(*) AS n FROM videos WHERE source IN (${placeholders(q.sources.length)})`, q.sources)]);
  if (q.shorts === "only") out.push(["shorts", count("shorts", "SELECT count(*) AS n FROM videos WHERE is_short = 1", [])]);
  if ((frozen.since || frozen.until) && q.sort !== "newest") {
    const p: string[] = [];
    const params: SQLInputValue[] = [];
    if (frozen.since) {
      p.push("publish_at >= ?");
      params.push(frozen.since);
    }
    if (frozen.until) {
      p.push("publish_at < ?");
      params.push(frozen.until);
    }
    out.push(["date", count("date", `SELECT count(*) AS n FROM videos WHERE ${p.join(" AND ")}`, params)]);
  }
  if (q.outlierRanges?.length && q.sort !== "outlier") {
    const o = outlierSql(q.outlierRanges, "outlier_score")!;
    out.push(["outlier", count("outlier", `SELECT count(*) AS n FROM videos WHERE ${o.sql}`, o.params)]);
  }
  if ((q.minViews != null || q.maxViews != null) && q.sort !== "views") {
    out.push(["views", count("views", "SELECT count(*) AS n FROM videos WHERE views >= ? AND views <= ?", [q.minViews ?? 0, q.maxViews ?? Number.MAX_SAFE_INTEGER])]);
  }
  if ((q.minSubs != null || q.maxSubs != null) && q.sort !== "subscribers") {
    out.push([
      "subs",
      count("subs", `SELECT count(*) AS n FROM videos WHERE ${SUBS_EXPR.replace("v.", "")} >= ? AND ${SUBS_EXPR.replace("v.", "")} <= ?`, [
        q.minSubs ?? 0,
        q.maxSubs ?? Number.MAX_SAFE_INTEGER,
      ]),
    ]);
  }
  return out;
}

/** Past this many rows a filter is too broad to drive by; counting further would only cost time. */
const COUNT_CAP = 100_000;

/**
 * Walk the sort index unless driving by one filter's index reads far fewer rows. Walking visits
 * about need·total/matches rows, with matches estimated from every candidate filter's share of
 * the library (assumed independent); driving reads and sorts the best filter's n rows.
 */
function chooseDriver(db: DatabaseSync, q: VideoQuery, frozen: Frozen, need: number): Driver {
  const candidates = candidateCounts(db, q, frozen, COUNT_CAP);
  if (!candidates.length) return "sort";
  const total = Math.max(totalVideos(db), 1);
  const [driver, n] = candidates.reduce((a, b) => (b[1] < a[1] ? b : a));
  const share = candidates.reduce((p, [, c]) => p * Math.min(1, c / total), 1);
  const matches = Math.max(total * share, 1);
  const walk = Math.min((need * total) / matches, total);
  return n * 3 < walk ? driver : "sort";
}

type Source = {
  /** Optional WITH clause (topic searches materialize scored candidates). */
  with: string;
  withParams: SQLInputValue[];
  from: string;
  where: Where;
  /** Sort keys in order (DESC), then `idExpr` DESC. */
  keys: { expr: string; nullable: boolean }[];
  /** Row id, always as `+….id` so SQLite never walks the id index to satisfy the ORDER BY. */
  idExpr: string;
  keyOf: (r: Row) => CursorKey[];
};

function topicWeights(db: DatabaseSync, terms: string[], phrase: string | null): { weights: number[]; phraseWeight: number | null; threshold: number } {
  const total = Math.max(totalVideos(db), 1);
  const idf = (expr: string) => {
    const n = cached(db, `df:${expr}`, 300_000, () => countOf(db, "SELECT count(*) AS n FROM videos_fts WHERE videos_fts MATCH ?", [expr]));
    return { n, w: Math.log(1 + (total - n + 0.5) / (n + 0.5)) };
  };
  const stats = terms.map((t) => idf(titleTerm(t)));
  const weights = stats.map((s) => Number(s.w.toFixed(6)));
  // Terms that match nothing can't contribute, so they don't raise the bar either.
  const reachable = stats.reduce((sum, s, i) => sum + (s.n > 0 ? weights[i] : 0), 0);
  const phraseWeight = phrase && phrase.split(" ").length > 1 ? Number((idf(titleTerm(phrase)).w * PHRASE_BOOST).toFixed(6)) : null;
  return { weights, phraseWeight, threshold: Number((reachable * TOPIC_MIN_SHARE).toFixed(6)) };
}

function buildSource(db: DatabaseSync, q: VideoQuery, frozen: Frozen, need: number): Source | null {
  const sortSpec = q.sort === "relevance" ? null : SORTS[q.sort];

  if (!q.q) {
    const driver = chooseDriver(db, q, frozen, need);
    const plus = driver !== "sort";
    const expr = plus ? `+${sortSpec!.expr}` : sortSpec!.expr;
    return {
      with: "",
      withParams: [],
      from: "videos v",
      where: filterWhere(q, frozen, driver),
      keys: [{ expr, nullable: sortSpec!.nullable }],
      idExpr: "+v.id",
      keyOf: (r) => [sortSpec!.key(r)],
    };
  }

  if (q.mode === "keyword") {
    const match = keywordExpression(q.q);
    if (!match) return null;
    const where = filterWhere(q, frozen, "fts");
    where.sql.unshift("videos_fts MATCH ?");
    where.params.unshift(match);
    return {
      with: "",
      withParams: [],
      from: "videos_fts f JOIN videos v ON v.rowid = f.rowid",
      where,
      keys: [{ expr: `+${sortSpec!.expr}`, nullable: sortSpec!.nullable }],
      idExpr: "+v.id",
      keyOf: (r) => [sortSpec!.key(r)],
    };
  }

  // Topic: OR-match the terms (and the whole phrase), score each candidate, keep good matches.
  const terms = topicTerms(q.q);
  if (!terms.length) return null;
  const phrase = topicPhrase(q.q);
  if (!frozen.weights || frozen.weights.length !== terms.length) Object.assign(frozen, topicWeights(db, terms, phrase));
  const weights = frozen.weights!;
  const phraseWeight = phrase && frozen.phraseWeight != null ? frozen.phraseWeight : null;
  const parts = [...terms.map(titleTerm), ...(phraseWeight != null ? [titleTerm(phrase!)] : [])];
  const match = `title : (${parts.map((p) => p.slice("title : ".length)).join(" OR ")})`;
  const inFts = "(f.rowid IN (SELECT rowid FROM videos_fts WHERE videos_fts MATCH ?))";
  const rawSql = terms.map(() => `? * ${inFts}`).join(" + ");
  const rawParams = terms.flatMap((t, i) => [weights[i], titleTerm(t)]);
  const filters = filterWhere(q, frozen, "fts");
  const inner = ["videos_fts MATCH ?", ...filters.sql];
  const withSql = `WITH t AS MATERIALIZED (
      SELECT ${COLUMNS}, coalesce(v.title_length, length(v.title)) AS _len, (${rawSql}) AS _raw,
             ${phraseWeight != null ? inFts : "0"} AS _ph
      FROM videos_fts f JOIN videos v ON v.rowid = f.rowid
      WHERE ${inner.join(" AND ")}
    ),
    m AS (
      SELECT *, coalesce(publish_at, '') AS _pa,
             round(((? + 1.0) / (1.0 + ? * (1.0 - ? + ? * _len * 1.0 / ?))) * (_raw + ? * _ph), 4) AS _score
      FROM t WHERE _raw >= ? OR _ph = 1
    )`;
  const withParams: SQLInputValue[] = [
    ...rawParams,
    ...(phraseWeight != null ? [titleTerm(phrase!)] : []),
    match,
    ...filters.params,
    BM25_K1, BM25_K1, BM25_B, BM25_B, frozen.avgLen ?? AVG_TITLE_LENGTH, phraseWeight ?? 0,
    frozen.threshold ?? 0,
  ];
  frozen.avgLen = frozen.avgLen ?? AVG_TITLE_LENGTH;
  const relevance = q.sort === "relevance";
  const mCol = (expr: string) => expr.replace(/\bv\./g, "m.");
  return {
    with: withSql,
    withParams,
    from: "m",
    where: { sql: [], params: [] },
    keys: relevance
      ? [
          { expr: "m._score", nullable: false },
          { expr: "m._pa", nullable: false },
        ]
      : [{ expr: mCol(sortSpec!.expr), nullable: sortSpec!.nullable }],
    idExpr: "+m.id",
    keyOf: (r) => (relevance ? [r._score ?? 0, r._pa ?? ""] : [sortSpec!.key(r)]),
  };
}

function selectSql(src: Source, extra: Where, order: string, limit: number): { sql: string; params: SQLInputValue[] } {
  const where = [...src.where.sql, ...extra.sql];
  const cols = src.from === "m" ? "m.*" : COLUMNS;
  return {
    sql: `${src.with} SELECT ${cols} FROM ${src.from}${where.length ? ` WHERE ${where.join(" AND ")}` : ""} ORDER BY ${order} LIMIT ?`,
    params: [...src.withParams, ...src.where.params, ...extra.params, limit],
  };
}

/** Rows strictly after the cursor position (or from the start), `n` at most. */
function fetchRows(db: DatabaseSync, src: Source, after: { k: CursorKey[]; id: string } | null, n: number): Row[] {
  const run = (extra: Where, order: string, limit: number) => {
    const { sql, params } = selectSql(src, extra, order, limit);
    return db.prepare(sql).all(...params) as Row[];
  };
  const id = src.idExpr;

  if (src.keys.length === 2) {
    const [k1, k2] = src.keys.map((k) => k.expr);
    const order = `${k1} DESC, ${k2} DESC, ${id} DESC`;
    if (!after) return run({ sql: [], params: [] }, order, n);
    const [v1, v2] = after.k;
    return run(
      { sql: [`(${k1} < ? OR (${k1} = ? AND (${k2} < ? OR (${k2} = ? AND ${id} < ?))))`], params: [v1, v1, v2, v2, after.id] },
      order,
      n,
    );
  }

  const { expr: k, nullable } = src.keys[0];
  const order = `${k} DESC, ${id} DESC`;
  const last = after?.k[0];
  if (!nullable) {
    if (!after) return run({ sql: [], params: [] }, order, n);
    return run({ sql: [`${k} <= ? AND (${k} < ? OR ${id} < ?)`], params: [last!, last!, after.id] }, order, n);
  }
  // Nullable sort column: non-null values first (DESC), then the NULL rows by id.
  const rows: Row[] = [];
  if (!after || last !== null) {
    const extra: Where = after
      ? { sql: [`${k} <= ? AND (${k} < ? OR ${id} < ?)`], params: [last!, last!, after.id] }
      : { sql: [`${k} IS NOT NULL`], params: [] };
    rows.push(...run(extra, order, n));
  }
  if (rows.length < n) {
    const extra: Where = { sql: [`${k} IS NULL`], params: [] };
    if (after && last === null) {
      extra.sql.push(`${id} < ?`);
      extra.params.push(after.id);
    }
    rows.push(...run(extra, `${id} DESC`, n - rows.length));
  }
  return rows;
}

function countRows(db: DatabaseSync, src: Source): number {
  const where = src.where.sql;
  const sql = `${src.with} SELECT count(*) AS n FROM ${src.from}${where.length ? ` WHERE ${where.join(" AND ")}` : ""}`;
  return countOf(db, sql, [...src.withParams, ...src.where.params]);
}

// ------------------------------------------------------------------ public API

/** One page of videos matching the filters. Throws QueryError on invalid input. */
export function searchVideos(input: VideoSearchInput = {}): VideoPage {
  const db = libraryDb();
  const q = normalizeVideoQuery(input, db);
  return runQuery(db, q);
}

export function runQuery(db: DatabaseSync, q: VideoQuery): VideoPage {
  const hash = queryHash(q.identity);
  let cursor: CursorState | null = null;
  if (q.cursor) {
    cursor = decodeCursor(q.cursor);
    if (cursor.h !== hash) throw cursorMismatch();
  }
  const now = new Date();
  const frozen: Frozen = cursor
    ? { ...cursor.f }
    : { since: parseDateBound("since", q.since, "start", now), until: parseDateBound("until", q.until, "end", now) };
  validateFrozen(frozen);

  const mode = q.q ? q.mode : null;
  const src = buildSource(db, q, frozen, q.limit + 1);
  if (!src) return { data: [], nextCursor: null, hasMore: false, ...(q.count ? { total: 0 } : {}), sort: q.sort, mode };

  const rows = fetchRows(db, src, cursor ? { k: cursor.k, id: cursor.id } : null, q.limit + 1);
  const hasMore = rows.length > q.limit;
  const page = rows.slice(0, q.limit);
  const last = page[page.length - 1];
  const nextCursor =
    hasMore && last ? encodeCursor({ v: 1, h: hash, k: src.keyOf(last), id: last.id, f: frozen }) : null;
  const data = page.map((r) => pickFields(toVideoRecord(r), q.fields));
  return {
    data,
    nextCursor,
    hasMore,
    ...(q.count ? { total: countRows(db, src) } : {}),
    sort: q.sort,
    mode,
  };
}

function validateFrozen(f: Frozen) {
  const num = (x: unknown) => typeof x === "number" && Number.isFinite(x);
  const iso = (x: unknown) => x == null || (typeof x === "string" && !Number.isNaN(Date.parse(x)));
  if (
    !iso(f.since) ||
    !iso(f.until) ||
    (f.weights != null && (!Array.isArray(f.weights) || !f.weights.every(num))) ||
    (f.phraseWeight != null && !num(f.phraseWeight)) ||
    (f.avgLen != null && (!num(f.avgLen) || f.avgLen <= 0)) ||
    (f.threshold != null && !num(f.threshold))
  ) {
    throw new QueryError("Invalid cursor. Pass the nextCursor value from a previous response unchanged.", { code: "invalid_cursor" });
  }
}

/** Number of videos matching the filters (ignores limit, cursor and fields). */
export function countVideos(input: VideoSearchInput = {}): number {
  const db = libraryDb();
  const q = normalizeVideoQuery({ ...input, cursor: undefined, count: undefined }, db);
  const now = new Date();
  const frozen: Frozen = { since: parseDateBound("since", q.since, "start", now), until: parseDateBound("until", q.until, "end", now) };
  const src = buildSource(db, q, frozen, q.limit + 1);
  return src ? countRows(db, src) : 0;
}

/** The YouTube video id in a watch/shorts/embed/youtu.be URL, or the input unchanged. */
export function parseVideoRef(input: string): string {
  const s = input.trim();
  if (!/youtu\.?be|youtube\.com/i.test(s)) return s;
  try {
    const url = new URL(/^https?:/i.test(s) ? s : `https://${s}`);
    const v = url.searchParams.get("v");
    if (v) return v;
    const parts = url.pathname.split("/").filter(Boolean);
    if (/youtu\.be$/i.test(url.hostname) && parts[0]) return parts[0];
    const i = parts.findIndex((p) => ["shorts", "embed", "live", "v", "e"].includes(p));
    if (i >= 0 && parts[i + 1]) return parts[i + 1];
  } catch {
    // not a URL after all
  }
  return s;
}

/** A video by YouTube video id, watch URL, or library row id. */
export function getVideo(ref: string): VideoRecord | null {
  const id = parseVideoRef(ref);
  if (!id) return null;
  const row = libraryDb()
    .prepare(`SELECT ${COLUMNS} FROM videos v WHERE v.video_id = ? OR v.id = ? ORDER BY (v.id = ?) DESC, v.views DESC LIMIT 1`)
    .get(id, id, id) as Row | undefined;
  return row ? toVideoRecord(row) : null;
}
