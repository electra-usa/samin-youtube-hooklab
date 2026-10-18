// Library taxonomies for the query core (CLI + /api/v1): performance tiers, the 48 click
// triggers, the 45 niches and the 7 title formats with the `frame` value each maps to.
// Framework-free (runs in Next and plain Node), so the JSON is imported with an attribute.
import raw from "../../taxonomy.json" with { type: "json" };
import { QueryError } from "./errors.ts";

export type TierInfo = {
  id: string;
  label: string;
  scoreLabel: string;
  /** Inclusive lower bound of the outlier score. */
  min: number;
  /** Exclusive upper bound; null for the open-ended top tier. */
  max: number | null;
};

export type TitleFormatInfo = { name: string; frame: string; description: string };

export const TIERS: TierInfo[] = raw.performance_tiers.map((t) => ({
  id: t.id,
  label: t.label,
  scoreLabel: t.scoreLabel,
  min: t.min,
  max: t.max >= 999 ? null : t.max,
}));

export const CLICK_TRIGGERS: string[] = [...raw.click_triggers];
export const NICHES: string[] = [...raw.niches];
export const POVS: string[] = [...raw.povs];

const FORMAT_FRAMES: Record<string, { frame: string; description: string }> = {
  Challenge: { frame: "experiment", description: "Challenges, experiments and tests" },
  Tutorial: { frame: "tutorial", description: "How-tos and step-by-step guides" },
  Explainer: { frame: "analysis", description: "Explainers, breakdowns and analysis" },
  List: { frame: "list", description: "Lists and rankings" },
  Story: { frame: "story", description: "Stories and personal journeys" },
  Review: { frame: "review", description: "Reviews and comparisons" },
  Reaction: { frame: "reaction", description: "Reactions and commentary" },
};

export const TITLE_FORMATS: TitleFormatInfo[] = raw.title_formats.map((name) => ({
  name,
  frame: FORMAT_FRAMES[name]?.frame ?? name.toLowerCase(),
  description: FORMAT_FRAMES[name]?.description ?? "",
}));

const FORMAT_BY_FRAME = new Map(TITLE_FORMATS.map((f) => [f.frame, f.name]));

export function titleFormatForFrame(frame: string | null | undefined): string | null {
  return frame ? (FORMAT_BY_FRAME.get(frame) ?? null) : null;
}

export function tierForScore(score: number | null | undefined): TierInfo | null {
  if (score == null || !Number.isFinite(score)) return null;
  return TIERS.find((t) => score >= t.min && (t.max == null || score < t.max)) ?? null;
}

/** "Marketing and Business", "marketing-business" and "MARKETING & BUSINESS" compare equal. */
export function looseKey(value: string): string {
  return value
    .toLowerCase()
    .replace(/\band\b/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, "");
}

function canonicalizer(kind: string, values: readonly string[]) {
  const byKey = new Map(values.map((v) => [looseKey(v), v]));
  return (input: string): string => {
    const hit = byKey.get(looseKey(input));
    if (hit) return hit;
    throw new QueryError(`Unknown ${kind} "${input}". Run \`hooklab taxonomy\` or GET /api/v1/taxonomy for the list.`, {
      code: "invalid_parameter",
      details: { allowed: values },
    });
  };
}

export const canonicalNiche = canonicalizer("niche", NICHES);
export const canonicalTrigger = canonicalizer("click trigger", CLICK_TRIGGERS);

const tierById = canonicalizer(
  "tier",
  TIERS.map((t) => t.id),
);
const tierByLabel = new Map(TIERS.map((t) => [looseKey(t.label), t.id]));

/** Tier id from an id ("bangers") or label ("Mega Bangers"). */
export function canonicalTier(input: string): string {
  return tierByLabel.get(looseKey(input)) ?? tierById(input);
}

/** Title format name from a format name ("Explainer") or its frame ("analysis"). */
export function canonicalTitleFormat(input: string): string {
  const key = looseKey(input);
  const hit = TITLE_FORMATS.find((f) => looseKey(f.name) === key || looseKey(f.frame) === key);
  if (hit) return hit.name;
  throw new QueryError(`Unknown title format "${input}". Use one of: ${TITLE_FORMATS.map((f) => f.name).join(", ")}.`, {
    code: "invalid_parameter",
    details: { allowed: TITLE_FORMATS.map((f) => f.name) },
  });
}

export function framesForFormats(formats: string[]): string[] {
  return TITLE_FORMATS.filter((f) => formats.includes(f.name)).map((f) => f.frame);
}

export type Taxonomy = {
  tiers: TierInfo[];
  clickTriggers: string[];
  niches: string[];
  titleFormats: TitleFormatInfo[];
  povs: string[];
  searchModes: { id: "topic" | "keyword"; description: string }[];
  sorts: { id: string; description: string }[];
};

export function taxonomy(): Taxonomy {
  return {
    tiers: TIERS.map((t) => ({ ...t })),
    clickTriggers: [...CLICK_TRIGGERS],
    niches: [...NICHES],
    titleFormats: TITLE_FORMATS.map((f) => ({ ...f })),
    povs: [...POVS],
    searchModes: [
      { id: "topic", description: "Videos about a topic: stemmed terms, any may match, ranked by relevance (BM25)." },
      { id: "keyword", description: "Titles containing every word (quoted phrases stay phrases)." },
    ],
    sorts: [
      { id: "relevance", description: "Best topic match first (default for topic searches)." },
      { id: "newest", description: "Most recently published first (default otherwise)." },
      { id: "outlier", description: "Highest outlier score first." },
      { id: "views", description: "Most views first." },
      { id: "subscribers", description: "Biggest channels first." },
    ],
  };
}
