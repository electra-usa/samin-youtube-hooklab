import "server-only";
import type { SQLInputValue } from "node:sqlite";
import { library, toOutlierVideo, type LibraryVideoRow, type OutlierVideo } from "@/lib/db/library";
import { CLICK_TRIGGERS, NICHES, TITLE_FORMATS, publishWindowStart } from "@/lib/taxonomy";
import {
  NO_SCORE_CEILING,
  PAGE_SIZE,
  SUBSCRIBERS_CEILING,
  TITLE_FORMAT_FRAMES,
  TITLE_LENGTH_CEILING,
  VIEWS_CEILING,
  normalizeSearchMode,
  parseChannelId,
  type NewsletterFilter,
  type SearchMode,
  type SortOrder,
  type VideoType,
} from "./filters";
import { enrichVideos, hiddenChannelIds } from "./app-data";
import { keywordMatch, topicMatch, topicTerms } from "./text";
import { formulaMatches } from "./formula-index";
import { VIDEO_COLUMNS, findAnyVideo } from "./videos";

// GET /api/outliers/videos: the original's parameters, answered from the exported library.

export type OutliersParams = {
  type: VideoType;
  sort: SortOrder;
  page: number;
  search: string;
  searchMode: SearchMode;
  referenceVideoId: string | null;
  channelId: string | null;
  channelName: string | null;
  outlierMin: number;
  outlierMax: number;
  viewsMin: number;
  viewsMax: number;
  subscriberMin: number;
  subscriberMax: number;
  titleLengthMin: number;
  titleLengthMax: number;
  newsletterFeatured: NewsletterFilter;
  publishDate: string;
  excludePublishDate: string;
  clickTriggers: string[];
  niches: string[];
  titleFormats: string[];
  excludeClickTriggers: string[];
  excludeNiches: string[];
};

export type OutliersResult = {
  success: true;
  videos: OutlierVideo[];
  hasMore: boolean;
  page: number;
  referenceVideoId: string | null;
  searchMode: SearchMode | null;
  /** Set when a mode had to be approximated (thumbnail search without image embeddings). */
  notice?: string;
  reference?: { id: string; videoId: string; title: string } | null;
};

const num = (value: string | null, fallback: number) => {
  const n = value == null || value.trim() === "" ? Number.NaN : Number(value);
  return Number.isFinite(n) ? n : fallback;
};

const list = (value: string | null, allowed: readonly string[]) =>
  value ? [...new Set(value.split(",").map((s) => s.trim()).filter((s) => allowed.includes(s)))] : [];

export function parseOutliersParams(sp: URLSearchParams): OutliersParams {
  const sort = sp.get("sort");
  const channel = sp.get("channel")?.trim() || null;
  const channelId = parseChannelId(channel);
  const newsletter = sp.get("newsletterFeatured");
  return {
    type: sp.get("type") === "shorts" ? "shorts" : "longform",
    sort: sort === "outlier" || sort === "views" ? sort : "newest",
    page: Math.min(10_000, Math.max(0, Math.floor(num(sp.get("page"), 0)))),
    search: (sp.get("search") ?? "").trim().slice(0, 200),
    searchMode: normalizeSearchMode(sp.get("searchMode")),
    referenceVideoId: sp.get("referenceVideoId")?.trim() || null,
    channelId,
    channelName: channel && !channelId ? channel : null,
    outlierMin: Math.max(0, num(sp.get("outlierMin"), 0)),
    outlierMax: num(sp.get("outlierMax"), NO_SCORE_CEILING),
    viewsMin: Math.max(0, num(sp.get("viewsMin"), 0)),
    viewsMax: num(sp.get("viewsMax"), VIEWS_CEILING),
    subscriberMin: Math.max(0, num(sp.get("subscriberMin"), 0)),
    subscriberMax: num(sp.get("subscriberMax"), SUBSCRIBERS_CEILING),
    titleLengthMin: Math.max(0, num(sp.get("titleLengthMin"), 0)),
    titleLengthMax: num(sp.get("titleLengthMax"), TITLE_LENGTH_CEILING),
    newsletterFeatured: newsletter === "featured" || newsletter === "not_featured" ? newsletter : "all",
    publishDate: sp.get("publishDate") ?? "all",
    excludePublishDate: sp.get("excludePublishDate") ?? "all",
    clickTriggers: list(sp.get("clickTriggers"), CLICK_TRIGGERS),
    niches: list(sp.get("niches"), NICHES),
    titleFormats: list(sp.get("titleFormats"), TITLE_FORMATS),
    excludeClickTriggers: list(sp.get("excludeClickTriggers"), CLICK_TRIGGERS),
    excludeNiches: list(sp.get("excludeNiches"), NICHES),
  };
}

type Where = { sql: string[]; params: SQLInputValue[] };

// An included niche/trigger set this small drives the query through its index;
// larger sets are cheaper to check per row while walking the sort index.
const DRIVE_BY_INDEX_MAX = 4000;

function addInclude(where: Where, table: "video_niches" | "video_click_triggers", values: string[]) {
  if (!values.length) return;
  const column = table === "video_niches" ? "niche" : "click_trigger";
  const json = table === "video_niches" ? "niches" : "click_triggers";
  const marks = values.map(() => "?").join(", ");
  const { n } = library().prepare(`SELECT count(*) AS n FROM ${table} WHERE ${column} IN (${marks})`).get(...values) as { n: number };
  if (n <= DRIVE_BY_INDEX_MAX) {
    where.sql.push(`v.id IN (SELECT video_row_id FROM ${table} WHERE ${column} IN (${marks}))`);
    where.params.push(...values);
  } else {
    // JSON array columns hold the same values; match the quoted element.
    where.sql.push(`(${values.map(() => `instr(v.${json}, ?) > 0`).join(" OR ")})`);
    where.params.push(...values.map((v) => JSON.stringify(v)));
  }
}

/** WHERE clauses for every filter except search. */
export function filterWhere(p: OutliersParams, hidden: string[]): Where {
  const w: Where = { sql: ["v.is_short = ?"], params: [p.type === "shorts" ? 1 : 0] };
  const add = (sql: string, ...params: SQLInputValue[]) => {
    w.sql.push(sql);
    w.params.push(...params);
  };
  if (p.outlierMin > 0) add("v.outlier_score >= ?", p.outlierMin);
  if (p.outlierMax < NO_SCORE_CEILING) add("v.outlier_score < ?", p.outlierMax);
  if (p.viewsMin > 0) add("v.views >= ?", p.viewsMin);
  if (p.viewsMax < VIEWS_CEILING) add("v.views <= ?", p.viewsMax);
  if (p.subscriberMin > 0) add("v.subscriber_count >= ?", p.subscriberMin);
  if (p.subscriberMax < SUBSCRIBERS_CEILING) add("v.subscriber_count <= ?", p.subscriberMax);
  if (p.titleLengthMin > 0) add("v.title_length >= ?", p.titleLengthMin);
  if (p.titleLengthMax < TITLE_LENGTH_CEILING) add("v.title_length <= ?", p.titleLengthMax);
  if (p.newsletterFeatured !== "all") add("v.featured_in_newsletter = ?", p.newsletterFeatured === "featured" ? 1 : 0);
  const from = publishWindowStart(p.publishDate);
  if (from) add("v.publish_at >= ?", from);
  const notAfter = publishWindowStart(p.excludePublishDate);
  if (notAfter) add("v.publish_at < ?", notAfter);
  addInclude(w, "video_niches", p.niches);
  addInclude(w, "video_click_triggers", p.clickTriggers);
  for (const n of p.excludeNiches) add("instr(v.niches, ?) = 0", JSON.stringify(n));
  for (const t of p.excludeClickTriggers) add("instr(v.click_triggers, ?) = 0", JSON.stringify(t));
  const frames = p.titleFormats.map((f) => TITLE_FORMAT_FRAMES[f]).filter(Boolean);
  if (frames.length) {
    const marks = frames.map(() => "?").join(", ");
    add(`(v.frame IN (${marks}) OR v.secondary_frame IN (${marks}))`, ...frames, ...frames);
  }
  if (p.channelId) add("v.channel_id = ?", p.channelId);
  else if (p.channelName) add("v.channel_name = ? COLLATE NOCASE", p.channelName);
  if (hidden.length) add("(v.channel_id IS NULL OR v.channel_id NOT IN (SELECT value FROM json_each(?)))", JSON.stringify(hidden));
  return w;
}

const ORDER: Record<SortOrder, string> = {
  newest: "v.publish_at DESC",
  outlier: "v.outlier_score DESC",
  views: "v.views DESC",
};

const THUMBNAIL_NOTICE =
  "Thumbnail search needs image embeddings, which HookLab doesn't have. Showing videos whose titles share the topic instead.";

export function queryOutliers(p: OutliersParams): OutliersResult {
  const db = library();
  const hidden = hiddenChannelIds();
  const where = filterWhere(p, hidden);
  const limit = PAGE_SIZE + 1;
  const offset = p.page * PAGE_SIZE;

  let mode: SearchMode | null = null;
  let queryText = "";
  let typed = true;
  let reference: OutliersResult["reference"] = null;
  if (p.referenceVideoId) {
    const ref = findAnyVideo(p.referenceVideoId);
    if (!ref) throw new ReferenceNotFound(p.referenceVideoId);
    reference = { id: ref.id, videoId: ref.videoId, title: ref.title };
    mode = p.searchMode === "keyword" ? "topic" : p.searchMode;
    queryText = ref.title;
    typed = false;
    where.sql.push("v.id != ? AND v.video_id != ?");
    where.params.push(ref.id, ref.videoId);
  } else if (p.search) {
    mode = p.searchMode;
    queryText = p.search;
  }

  const base = {
    success: true as const,
    page: p.page,
    referenceVideoId: p.referenceVideoId,
    searchMode: mode,
    reference,
    ...(mode === "thumbnail" ? { notice: THUMBNAIL_NOTICE } : {}),
  };
  const finish = (rows: LibraryVideoRow[]) => ({
    ...base,
    videos: enrichVideos(rows.slice(0, PAGE_SIZE).map(toOutlierVideo)),
    hasMore: rows.length > PAGE_SIZE,
  });
  const whereSql = where.sql.join(" AND ");

  if (!mode) {
    const rows = db
      .prepare(`SELECT ${VIDEO_COLUMNS} FROM videos v WHERE ${whereSql} ORDER BY ${ORDER[p.sort]} LIMIT ? OFFSET ?`)
      .all(...where.params, limit, offset) as LibraryVideoRow[];
    return finish(rows);
  }

  if (mode === "title_pattern") {
    const matches = formulaMatches(queryText, { typed });
    if (!matches.length) return finish([]);
    const score = new Map(matches.map((m) => [m.id, m.score]));
    const rows = db
      .prepare(`SELECT ${VIDEO_COLUMNS} FROM videos v WHERE v.id IN (SELECT value FROM json_each(?)) AND ${whereSql}`)
      .all(JSON.stringify(matches.map((m) => m.id)), ...where.params) as LibraryVideoRow[];
    rows.sort(
      (a, b) =>
        (score.get(b.id) ?? 0) - (score.get(a.id) ?? 0) || (b.publish_at ?? "").localeCompare(a.publish_at ?? ""),
    );
    return finish(rows.slice(offset, offset + limit));
  }

  if (mode === "keyword") {
    const match = keywordMatch(queryText);
    if (!match) return finish([]);
    const rows = db
      .prepare(
        `SELECT ${VIDEO_COLUMNS} FROM videos_fts f JOIN videos v ON v.rowid = f.rowid
         WHERE videos_fts MATCH ? AND ${whereSql} ORDER BY ${ORDER[p.sort]} LIMIT ? OFFSET ?`,
      )
      .all(match, ...where.params, limit, offset) as LibraryVideoRow[];
    return finish(rows);
  }

  // Topic (and thumbnail's stand-in): stemmed OR-query, best bm25 band first, then newest.
  const terms = topicTerms(queryText, { fromTitle: !typed, max: typed ? 12 : 10 });
  const match = topicMatch(terms, typed ? queryText : undefined) ?? keywordMatch(queryText);
  if (!match) return finish([]);
  const rows = db
    .prepare(
      `SELECT ${VIDEO_COLUMNS} FROM videos_fts f JOIN videos v ON v.rowid = f.rowid
       WHERE videos_fts MATCH ? AND ${whereSql}
       ORDER BY CAST(bm25(videos_fts, 1.0, 0.0) * 2 AS INTEGER), v.publish_at DESC LIMIT ? OFFSET ?`,
    )
    .all(match, ...where.params, limit, offset) as LibraryVideoRow[];
  return finish(rows);
}

export class ReferenceNotFound extends Error {
  constructor(readonly id: string) {
    super("Reference video not found");
  }
}
