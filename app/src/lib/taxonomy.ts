// Taxonomies shipped in the original app's Outliers and chat bundles
// (extracted by scripts/extract-taxonomy.py; provenance in research/taxonomy-sources.json).
import raw from "./taxonomy.json";

export type Tier = {
  id: string;
  label: string;
  scoreLabel: string;
  min: number;
  max: number;
  dotClass: string;
  badgeClass: string;
};

export const PUBLISH_DATE_WINDOWS: { id: string; label: string }[] = raw.publish_date_windows;
export const PERFORMANCE_TIERS: Tier[] = raw.performance_tiers as Tier[];
export const CLICK_TRIGGERS: string[] = raw.click_triggers;
export const NICHES: string[] = raw.niches;
export const TITLE_FORMATS: string[] = raw.title_formats;
export const SEARCH_MODES: { id: string; label: string; description: string }[] = raw.search_modes;
export const TITLE_FEEDBACK_REASONS: { value: string; label: string }[] = raw.title_feedback_reasons;
export const POVS: string[] = raw.povs;
export const CHAT_PROGRESS_STAGES: string[] = raw.chat_progress_stages;

export const DEFAULT_OUTLIER_FILTERS = {
  videoType: "longform" as "longform" | "shorts",
  selectedTierIds: ["above_avg", "great", "bangers", "mega_bangers"],
  publishDate: "all",
  excludedPublishDate: "all",
  viewsMin: 10_000,
  viewsMax: 20_000_000,
  subscriberMin: 0,
  subscriberMax: 50_000_000,
  titleLengthMin: 0,
  titleLengthMax: 100,
  newsletterFeatured: "all" as "all" | "featured" | "not_featured",
  selectedClickTriggers: [] as string[],
  selectedNiches: [] as string[],
  selectedTitleFormats: [] as string[],
  excludedClickTriggers: [] as string[],
  excludedNiches: ["Geopolitics & Economics", "Legal", "News & Politics"],
};

/** Upper bound the views slider treats as "20M+" (no limit). */
export const VIEWS_SLIDER_MAX = 20_000_000;

export function tierForScore(score: number | null | undefined): Tier | null {
  if (score == null || Number.isNaN(score)) return null;
  return (
    PERFORMANCE_TIERS.find((t) => score >= t.min && score < t.max) ??
    (score >= 50 ? PERFORMANCE_TIERS[PERFORMANCE_TIERS.length - 1] : null)
  );
}

// Same three-way split as the original getClickTriggerColor().
const GREEN_TRIGGERS = new Set([
  "Beginners", "Authority", "Daily", "Desire", "Experience", "New", "Refute Objection",
  "SEO-Friendly", "Seasonality", "Social Proof", "Specific Audience", "Speed", "Status", "Transformation",
]);
const RED_TRIGGERS = new Set([
  "Conflict", "Conspiracy", "Controversy", "Drama", "Escape", "Fear", "FOMO", "Mistake",
  "Negativity", "Pain Point", "Regret", "Warning", "Urgency",
]);

export type TriggerColor = "green" | "red" | "blue";

export function triggerColor(trigger: string): TriggerColor {
  if (GREEN_TRIGGERS.has(trigger)) return "green";
  if (RED_TRIGGERS.has(trigger)) return "red";
  return "blue";
}

export const TRIGGER_PILL_CLASSES: Record<TriggerColor, string> = {
  green: "brand-accent-chip",
  red: "bg-red-500/10 text-red-700 dark:bg-red-500/20 dark:text-red-400",
  blue: "brand-accent-blue-chip",
};

export const TRIGGER_OUTLINE_CLASSES: Record<TriggerColor, string> = {
  green: "border border-green-700/50 text-green-800 dark:border-green-400/50 dark:text-green-300",
  red: "border border-red-600/50 text-red-700 dark:border-red-400/50 dark:text-red-300",
  blue: "border border-sky-600/50 text-sky-800 dark:border-sky-400/50 dark:text-sky-300",
};

export const TRIGGER_SOLID_CLASSES: Record<TriggerColor, string> = {
  green: "bg-green-700 text-white dark:bg-green-600",
  red: "bg-red-600 text-white",
  blue: "bg-sky-700 text-white dark:bg-sky-600",
};

/** Cutoff date (ISO) for a publish-date window id, or null for "all". */
export function publishWindowStart(id: string, now = new Date()): string | null {
  const d = new Date(now);
  switch (id) {
    case "week":
      d.setDate(d.getDate() - 7);
      break;
    case "month":
      d.setMonth(d.getMonth() - 1);
      break;
    case "3months":
      d.setMonth(d.getMonth() - 3);
      break;
    case "6months":
      d.setMonth(d.getMonth() - 6);
      break;
    case "year":
      d.setFullYear(d.getFullYear() - 1);
      break;
    case "2years":
      d.setFullYear(d.getFullYear() - 2);
      break;
    default:
      return null;
  }
  return d.toISOString();
}
