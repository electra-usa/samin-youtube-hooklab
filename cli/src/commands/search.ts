import { FILTER_FLAGS, FILTER_HELP, filtersFromFlags, parseFlags } from "../args.ts";
import { VIDEO_FIELDS, searchVideos, type VideoSearchInput } from "../core.ts";
import type { Command } from "../types.ts";
import { printVideoPage } from "../videos-view.ts";

const command: Command = {
  name: "search",
  summary: "Search the outlier library by topic or keyword, with filters",
  usage: `Usage: hooklab search [query…] [filters]

A query searches video titles. Topic mode (default) matches any stemmed term and ranks by
relevance; --mode keyword requires every word ("quoted phrases" stay together). Without a
query, every video matching the filters is listed, newest first.

${FILTER_HELP}
  --count                     also print the total number of matches (stderr)

Tables show 25 rows unless --limit is set (JSON/JSONL/CSV default to 50). The next page's
cursor is printed on stderr: pass it back with --cursor.

Fields for --fields: ${VIDEO_FIELDS.join(", ")}, relevance

Examples
  hooklab search "ai agents" --min-outlier 5 --since 30d
  hooklab search "claude code" --mode keyword --sort views --limit 10
  hooklab search --niche Finance --tier bangers,mega_bangers --sort outlier
  hooklab search "budget travel" --exclude-niche "News & Politics" --csv > travel.csv
  hooklab search "ai agents" --fields videoId,title,outlierScore --jsonl | jq -r .title`,
  async run(argv, ctx) {
    const { values, positionals } = parseFlags(argv, { ...FILTER_FLAGS, count: { type: "boolean" } });
    const input: VideoSearchInput = filtersFromFlags(values, positionals);
    if (values.count) input.count = true;
    if (input.limit == null && ctx.format === "table") input.limit = 25;
    const page = searchVideos(input);
    printVideoPage(page, ctx, { fields: typeof values.fields === "string" ? values.fields.split(",").map((s) => s.trim()) : null });
  },
};

export default command;
