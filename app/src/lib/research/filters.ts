// Filter model shared by the Outliers and Following pages and their API routes.
// Client-safe: no server imports. Defaults, step scales and labels follow the
// original OutliersView bundle (evidence/scripts-all, source-28 / source-35).
import {
  CLICK_TRIGGERS,
  NICHES,
  PERFORMANCE_TIERS,
  PUBLISH_DATE_WINDOWS,
  SEARCH_MODES,
  TITLE_FORMATS,
  type Tier,
} from "@/lib/taxonomy";

export type VideoType = "longform" | "shorts";
export type NewsletterFilter = "all" | "featured" | "not_featured";
export type SearchMode = "topic" | "keyword" | "title_pattern" | "thumbnail";
export type SortOrder = "newest" | "outlier" | "views";

export type OutlierFilters = {
  videoType: VideoType;
  selectedTierIds: string[];
  publishDate: string;
  excludedPublishDate: string;
  viewsMin: number;
  viewsMax: number;
  subscriberMin: number;
  subscriberMax: number;
  titleLengthMin: number;
  titleLengthMax: number;
  newsletterFeatured: NewsletterFilter;
  selectedClickTriggers: string[];
  selectedNiches: string[];
  selectedTitleFormats: string[];
  excludedClickTriggers: string[];
  excludedNiches: string[];
};

/** Upper score bound meaning "no ceiling" (Mega Bangers' max). */
export const NO_SCORE_CEILING = 999;
/** Views slider floor/ceiling on Outliers (original VIDEO_LIMITS). 20M means "20M+". */
export const VIEWS_FLOOR = 1_000;
export const VIEWS_CEILING = 20_000_000;
/** Following starts at 0 views (original FOLLOWING_VIDEO_LIMITS). */
export const FOLLOWING_VIEWS_FLOOR = 0;
export const SUBSCRIBERS_CEILING = 50_000_000;
export const TITLE_LENGTH_CEILING = 100;
/** Duration at or under which a video counts as a Short when the source has no flag. */
export const SHORTS_MAX_SECONDS = 180;
export const PAGE_SIZE = 50;

export const VIEWS_STEPS = [1e3, 2e3, 3e3, 5e3, 1e4, 2e4, 5e4, 1e5, 2e5, 5e5, 1e6, 2e6, 5e6, 1e7, 2e7];
export const FOLLOWING_VIEWS_STEPS = [0, 100, 500, 1e3, 2e3, 3e3, 5e3, 1e4, 2e4, 5e4, 1e5, 2e5, 5e5, 1e6, 2e6, 5e6, 1e7, 2e7];
export const SUBSCRIBER_STEPS = [0, 1e3, 5e3, 1e4, 25e3, 5e4, 1e5, 25e4, 5e5, 1e6, 2e6, 5e6, 1e7, 25e6, 5e7];
export const TITLE_LENGTH_STEPS = Array.from({ length: 101 }, (_, i) => i);

export const DEFAULT_TIER_IDS = ["above_avg", "great", "bangers", "mega_bangers"];
const TIER_IDS = PERFORMANCE_TIERS.map((t) => t.id);
const WINDOW_IDS = PUBLISH_DATE_WINDOWS.map((w) => w.id);
const WINDOW_DAYS: Record<string, number> = { week: 7, month: 30, "3months": 90, "6months": 180, year: 365, "2years": 730 };

/** Title formats map onto the library's `frame` / `secondary_frame` values. */
export const TITLE_FORMAT_FRAMES: Record<string, string> = {
  Challenge: "experiment",
  Tutorial: "tutorial",
  Explainer: "analysis",
  List: "list",
  Story: "story",
  Review: "review",
  Reaction: "reaction",
};

export const SORTED_NICHES = [...NICHES].sort((a, b) => a.localeCompare(b));

export function defaultOutlierFilters(): OutlierFilters {
  return {
    videoType: "longform",
    selectedTierIds: [...DEFAULT_TIER_IDS],
    publishDate: "all",
    excludedPublishDate: "all",
    viewsMin: 10_000,
    viewsMax: VIEWS_CEILING,
    subscriberMin: 0,
    subscriberMax: SUBSCRIBERS_CEILING,
    titleLengthMin: 0,
    titleLengthMax: TITLE_LENGTH_CEILING,
    newsletterFeatured: "all",
    selectedClickTriggers: [],
    selectedNiches: [],
    selectedTitleFormats: [],
    excludedClickTriggers: [],
    excludedNiches: ["Geopolitics & Economics", "Legal", "News & Politics"],
  };
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

function pick<T extends string>(value: unknown, allowed: readonly string[], fallback: T): T {
  return typeof value === "string" && allowed.includes(value) ? (value as T) : fallback;
}

function clampInt(value: unknown, fallback: number, min: number, max: number): number {
  const n = typeof value === "number" ? value : typeof value === "string" ? Number.parseInt(value, 10) : Number.NaN;
  return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.trunc(n))) : fallback;
}

/** Keep only known values, in canonical order. */
function pickList(value: unknown, allowed: readonly string[], fallback: string[]): string[] {
  if (!Array.isArray(value)) return [...fallback];
  const wanted = new Set(value.filter((v): v is string => typeof v === "string"));
  return allowed.filter((v) => wanted.has(v));
}

/** Coerce anything (saved setting, request body) into a valid filter set. */
export function normalizeOutlierFilters(input: unknown): OutlierFilters {
  const d = defaultOutlierFilters();
  const s = isRecord(input) ? input : {};
  const vMin = clampInt(s.viewsMin, d.viewsMin, VIEWS_FLOOR, VIEWS_CEILING);
  const vMax = clampInt(s.viewsMax, d.viewsMax, VIEWS_FLOOR, VIEWS_CEILING);
  const sMin = clampInt(s.subscriberMin, d.subscriberMin, 0, SUBSCRIBERS_CEILING);
  const sMax = clampInt(s.subscriberMax, d.subscriberMax, 0, SUBSCRIBERS_CEILING);
  const tMin = clampInt(s.titleLengthMin, d.titleLengthMin, 0, TITLE_LENGTH_CEILING);
  const tMax = clampInt(s.titleLengthMax, d.titleLengthMax, 0, TITLE_LENGTH_CEILING);
  return {
    videoType: pick<VideoType>(s.videoType, ["longform", "shorts"], d.videoType),
    selectedTierIds: pickList(s.selectedTierIds, TIER_IDS, d.selectedTierIds),
    publishDate: pick(s.publishDate, WINDOW_IDS, d.publishDate),
    excludedPublishDate: pick(s.excludedPublishDate, WINDOW_IDS, d.excludedPublishDate),
    viewsMin: Math.min(vMin, vMax),
    viewsMax: Math.max(vMin, vMax),
    subscriberMin: Math.min(sMin, sMax),
    subscriberMax: Math.max(sMin, sMax),
    titleLengthMin: Math.min(tMin, tMax),
    titleLengthMax: Math.max(tMin, tMax),
    newsletterFeatured: pick<NewsletterFilter>(s.newsletterFeatured, ["all", "featured", "not_featured"], d.newsletterFeatured),
    selectedClickTriggers: pickList(s.selectedClickTriggers, CLICK_TRIGGERS, d.selectedClickTriggers),
    selectedNiches: pickList(s.selectedNiches, SORTED_NICHES, d.selectedNiches),
    selectedTitleFormats: pickList(s.selectedTitleFormats, TITLE_FORMATS, d.selectedTitleFormats),
    excludedClickTriggers: pickList(s.excludedClickTriggers, CLICK_TRIGGERS, d.excludedClickTriggers),
    excludedNiches: pickList(s.excludedNiches, SORTED_NICHES, d.excludedNiches),
  };
}

export function sameFilters(a: OutlierFilters, b: OutlierFilters): boolean {
  return JSON.stringify(normalizeOutlierFilters(a)) === JSON.stringify(normalizeOutlierFilters(b));
}

/** Selected tiers collapse to one score range: min of mins, max of maxes (999 = no ceiling). */
export function tierRange(ids: Iterable<string>): { min: number; max: number } {
  const set = new Set(ids);
  const tiers = PERFORMANCE_TIERS.filter((t) => set.has(t.id));
  if (!tiers.length) return { min: 0, max: NO_SCORE_CEILING };
  return { min: Math.min(...tiers.map((t) => t.min)), max: Math.max(...tiers.map((t) => t.max)) };
}

export function tiersById(ids: Iterable<string>): Tier[] {
  const set = new Set(ids);
  return PERFORMANCE_TIERS.filter((t) => set.has(t.id));
}

/** "10K", "2M", "20M+" (views slider labels). */
export function viewsLabel(n: number): string {
  if (n >= VIEWS_CEILING) return "20M+";
  if (n >= 1e6) return `${Math.round(n / 1e6)}M`;
  if (n >= 1e3) return `${Math.round(n / 1e3)}K`;
  return String(n);
}

/** "250K", "2.5M", "50M+" (subscriber slider labels). */
export function subscribersLabel(n: number): string {
  const compact = (v: number, suffix: string) => `${Number((v).toFixed(1))}${suffix}`;
  const s = n >= 1e9 ? compact(n / 1e9, "B") : n >= 1e6 ? compact(n / 1e6, "M") : n >= 1e3 ? compact(n / 1e3, "K") : String(n);
  return n >= SUBSCRIBERS_CEILING ? `${s}+` : s;
}

export function publishWindowLabel(id: string): string {
  return PUBLISH_DATE_WINDOWS.find((w) => w.id === id)?.label ?? id;
}

/** An excluded window must be shorter than the included one ("last year, but not the last month"). */
export function compatibleWindows(include: string, exclude: string): boolean {
  return include === "all" || exclude === "all" || WINDOW_DAYS[exclude] < WINDOW_DAYS[include];
}

/** "A" or "A +2". */
export function summarizeList(items: string[]): string {
  return items.length <= 1 ? items[0] ?? "" : `${items[0]} +${items.length - 1}`;
}

export const SEARCH_MODE_IDS: SearchMode[] = ["topic", "keyword", "title_pattern", "thumbnail"];

export function normalizeSearchMode(value: string | null | undefined, fallback: SearchMode = "topic"): SearchMode {
  if (value === "similar") return "topic";
  return SEARCH_MODE_IDS.includes(value as SearchMode) ? (value as SearchMode) : fallback;
}

export function searchModeLabel(mode: string): string {
  return SEARCH_MODES.find((m) => m.id === mode)?.label ?? "Topic";
}

export function searchPlaceholder(mode: SearchMode): string {
  switch (mode) {
    case "topic":
      return "Search for videos about a topic";
    case "title_pattern":
      return "Search videos that use the same title formulas";
    case "thumbnail":
      return "Search thumbnail visuals and design elements";
    default:
      return "Search for exact keywords in videos";
  }
}

/** `name-slug-UC…` as used in the original `?channel=` param. */
export function createChannelSlug(channelId: string, channelName: string): string {
  const slug = channelName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return slug ? `${slug}-${channelId}` : channelId;
}

export function parseChannelId(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (/^UC[\w-]{10,}$/.test(trimmed)) return trimmed;
  return /-(UC[\w-]+)$/.exec(trimmed)?.[1] ?? null;
}

export function parseChannelName(value: string | null | undefined): string | null {
  if (!value) return null;
  const m = /^(.+)-(UC[\w-]+)$/.exec(value.trim());
  return m
    ? m[1]
        .split("-")
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
        .join(" ")
    : null;
}

/** Link into an Outliers reference search ("find similar") from any page. */
export function referenceSearchHref(videoRowId: string, mode: SearchMode, title?: string): string {
  const p = new URLSearchParams();
  p.set("referenceVideoId", videoRowId);
  p.set("searchMode", mode);
  if (title?.trim()) p.set("referenceTitle", title.trim());
  return `/outliers?${p.toString()}`;
}

/** Prompt used by "Generate titles using this formula" (same wording as the original). */
export function remixPrompt(title: string): string {
  return `Give me 5 titles for my channel using a similar format as this video: "${title}"`;
}

export const chatHref = (prompt: string) => `/chat?prompt=${encodeURIComponent(prompt)}`;

export const studioHref = (title: string, videoId: string) =>
  `/studio?prefillTitle=${encodeURIComponent(title)}&videoId=${encodeURIComponent(videoId)}`;

/** Query string for GET /api/outliers/videos, built exactly like the original client. */
export function outliersQuery(
  f: OutlierFilters,
  opts: {
    page: number;
    search?: string;
    searchMode?: SearchMode;
    reference?: { id: string; mode: SearchMode } | null;
    channel?: string | null;
    sort?: SortOrder;
  },
): URLSearchParams {
  const p = new URLSearchParams();
  const { min, max } = tierRange(f.selectedTierIds);
  p.set("type", f.videoType);
  p.set("sort", opts.sort ?? "newest");
  p.set("page", String(opts.page));
  if (opts.reference) {
    p.set("referenceVideoId", opts.reference.id);
    p.set("searchMode", opts.reference.mode);
  } else if (opts.search?.trim()) {
    p.set("search", opts.search.trim());
    p.set("searchMode", opts.searchMode ?? "topic");
  }
  if (opts.channel) p.set("channel", opts.channel);
  p.set("outlierMin", String(min));
  p.set("outlierMax", String(max));
  p.set("viewsMin", String(f.viewsMin));
  p.set("viewsMax", String(f.viewsMax));
  p.set("subscriberMin", String(f.subscriberMin));
  p.set("subscriberMax", String(f.subscriberMax));
  if (f.titleLengthMin !== 0) p.set("titleLengthMin", String(f.titleLengthMin));
  if (f.titleLengthMax !== TITLE_LENGTH_CEILING) p.set("titleLengthMax", String(f.titleLengthMax));
  if (f.newsletterFeatured !== "all") p.set("newsletterFeatured", f.newsletterFeatured);
  p.set("publishDate", f.publishDate);
  if (f.excludedPublishDate !== "all") p.set("excludePublishDate", f.excludedPublishDate);
  if (f.selectedClickTriggers.length) p.set("clickTriggers", f.selectedClickTriggers.join(","));
  if (f.selectedNiches.length) p.set("niches", f.selectedNiches.join(","));
  if (f.selectedTitleFormats.length) p.set("titleFormats", f.selectedTitleFormats.join(","));
  if (f.excludedClickTriggers.length) p.set("excludeClickTriggers", f.excludedClickTriggers.join(","));
  if (f.excludedNiches.length) p.set("excludeNiches", f.excludedNiches.join(","));
  return p;
}
