import { FILTER_FLAGS, FILTER_HELP, filtersFromFlags, parseFlags } from "../args.ts";
import { searchVideos, type VideoSearchInput } from "../core.ts";
import type { Command } from "../types.ts";
import { printVideoPage } from "../videos-view.ts";

const command: Command = {
  name: "top",
  summary: "Top outliers: highest outlier scores, last 30 days by default",
  usage: `Usage: hooklab top [query…] [filters]

Shortcut for \`hooklab search --sort outlier --since 30d\`. Every search filter works; pass
--since with another window (7d, 3m, 2026-01-01) or --since all for the whole library.

${FILTER_HELP}
  --count                     also print the total number of matches (stderr)

Examples
  hooklab top
  hooklab top --since 7d --niche Technology --limit 10
  hooklab top "productivity" --min-views 100k
  hooklab top --since all --tier mega_bangers --json`,
  async run(argv, ctx) {
    const { values, positionals } = parseFlags(argv, { ...FILTER_FLAGS, count: { type: "boolean" } });
    const input: VideoSearchInput = filtersFromFlags(values, positionals);
    if (values.count) input.count = true;
    input.sort ??= "outlier";
    if (input.since == null) input.since = "30d";
    else if (/^(all|any|ever|none)$/i.test(String(input.since))) delete input.since;
    if (input.limit == null && ctx.format === "table") input.limit = 20;
    const page = searchVideos(input);
    printVideoPage(page, ctx, { fields: typeof values.fields === "string" ? values.fields.split(",").map((s) => s.trim()) : null });
  },
};

export default command;
