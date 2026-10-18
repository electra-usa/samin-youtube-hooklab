// Flag parsing shared by the library commands (node:util parseArgs, strict), and the mapping
// from `--min-outlier`-style flags to the query core's filter names.
import { parseArgs, type ParseArgsConfig } from "node:util";

/** Bad flags or arguments: main.ts prints the message plus a help hint and exits with 2. */
export class UsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UsageError";
  }
}

type Options = NonNullable<ParseArgsConfig["options"]>;

export function parseFlags<O extends Options>(argv: string[], options: O, opts: { positionals?: boolean } = {}) {
  try {
    return parseArgs({ args: argv, options, allowPositionals: opts.positionals ?? true, strict: true });
  } catch (err) {
    throw new UsageError(err instanceof Error ? err.message.replace(/\. To specify.*$/s, ".") : String(err));
  }
}

/** Every video filter as a flag. `--channel`, `--niche`, `--trigger`… are repeatable and take commas. */
export const FILTER_FLAGS = {
  mode: { type: "string" },
  "min-outlier": { type: "string" },
  "max-outlier": { type: "string" },
  tier: { type: "string", multiple: true },
  "min-views": { type: "string" },
  "max-views": { type: "string" },
  "min-subs": { type: "string" },
  "max-subs": { type: "string" },
  niche: { type: "string", multiple: true },
  "exclude-niche": { type: "string", multiple: true },
  trigger: { type: "string", multiple: true },
  "exclude-trigger": { type: "string", multiple: true },
  "format-type": { type: "string", multiple: true },
  channel: { type: "string", multiple: true },
  since: { type: "string" },
  until: { type: "string" },
  shorts: { type: "string" },
  source: { type: "string", multiple: true },
  sort: { type: "string" },
  limit: { type: "string" },
  cursor: { type: "string" },
  fields: { type: "string" },
} as const satisfies Options;

/** Flag → query-core filter name. */
const FLAG_TO_FILTER: Record<string, string> = {
  mode: "mode",
  "min-outlier": "minOutlier",
  "max-outlier": "maxOutlier",
  tier: "tier",
  "min-views": "minViews",
  "max-views": "maxViews",
  "min-subs": "minSubs",
  "max-subs": "maxSubs",
  niche: "niche",
  "exclude-niche": "excludeNiche",
  trigger: "trigger",
  "exclude-trigger": "excludeTrigger",
  "format-type": "format",
  channel: "channelId",
  since: "since",
  until: "until",
  shorts: "shorts",
  source: "source",
  sort: "sort",
  limit: "limit",
  cursor: "cursor",
  fields: "fields",
};

type FlagValues = Record<string, string | boolean | (string | boolean)[] | undefined>;

/** Query-core input from parsed flags plus the positional search words. */
export function filtersFromFlags(values: FlagValues, positionals: string[]): Record<string, string | string[] | undefined> {
  const input: Record<string, string | string[] | undefined> = {};
  const q = positionals.join(" ").trim();
  if (q) input.q = q;
  for (const [flag, name] of Object.entries(FLAG_TO_FILTER)) {
    const v = values[flag];
    if (v == null || typeof v === "boolean") continue;
    input[name] = Array.isArray(v) ? v.map(String) : v;
  }
  return input;
}

export const FILTER_HELP = `Filters
  --mode topic|keyword        topic (default): any stemmed term, ranked by relevance; keyword: every word
  --min-outlier N  --max-outlier N    outlier score, e.g. 5 or 5x
  --tier ID                   flops, below_avg, pretty_good, above_avg, great, bangers, mega_bangers
  --min-views N    --max-views N      e.g. 100k, 1.5M
  --min-subs N     --max-subs N       channel subscribers
  --niche NAME                any of these niches (repeat or comma-separate)
  --exclude-niche NAME
  --trigger NAME              any of these click triggers
  --exclude-trigger NAME
  --format-type NAME          title format: Challenge, Tutorial, Explainer, List, Story, Review, Reaction
  --channel ID|@handle|NAME   only this channel (repeatable)
  --since WHEN  --until WHEN  2026-09-30, 2026-09, a timestamp, or an age: 24h, 7d, 2w, 3m, 1y
  --shorts include|only|exclude
  --source NAME               row origin: export, rss, …
  --sort relevance|newest|outlier|views|subscribers
  --limit N                   1–1000 (default 50)
  --cursor C                  continue from a previous page's next cursor
  --fields a,b,c              output fields (see \`hooklab help fields\`)`;
