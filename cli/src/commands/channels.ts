import { parseFlags } from "../args.ts";
import { CHANNEL_SORTS, listChannels } from "../core.ts";
import { compact, day, grouped, renderTable, score } from "../format.ts";
import type { Command } from "../types.ts";

const command: Command = {
  name: "channels",
  summary: "List channels in the library (search by name or handle)",
  usage: `Usage: hooklab channels [query…] [--sort ${CHANNEL_SORTS.join("|")}] [--tracked] [--limit N] [--cursor C]

  --sort      videos (default), subscribers, outlier (best video), avgOutlier, views (total), latest, name
  --tracked   only channels added with \`hooklab library add\` (followed by the refresh pipeline)
  --limit     1–1000 (default 25 in tables, 50 otherwise)
  --cursor    continue from a previous page's next cursor (printed on stderr)

Examples
  hooklab channels
  hooklab channels engineer --sort subscribers
  hooklab channels --sort outlier --limit 10 --csv`,
  async run(argv, ctx) {
    const { values, positionals } = parseFlags(argv, {
      sort: { type: "string" },
      tracked: { type: "boolean" },
      limit: { type: "string" },
      cursor: { type: "string" },
    });
    const page = listChannels({
      q: positionals.join(" ").trim() || undefined,
      sort: values.sort,
      tracked: values.tracked,
      limit: values.limit ?? (ctx.format === "table" ? 25 : undefined),
      cursor: values.cursor,
    });
    if (ctx.format === "json") ctx.print({ data: page.data, nextCursor: page.nextCursor, hasMore: page.hasMore, total: page.total });
    else if (ctx.format !== "table") ctx.print(page.data as unknown as Record<string, unknown>[]);
    else if (!page.data.length) ctx.info("No channels match.");
    else {
      const rows = page.data.map((c) => ({
        channel: `${c.channelName ?? "?"}${c.tracked ? " •" : ""}`,
        handle: c.handle ?? "",
        id: c.channelId,
        subs: compact(c.subscriberCount),
        videos: grouped(c.videoCount),
        avg: score(c.avgOutlierScore),
        best: score(c.maxOutlierScore),
        latest: day(c.latestPublishAt),
      }));
      const cols = rows.some((r) => r.handle) ? ["channel", "handle", "id", "subs", "videos", "avg", "best", "latest"] : ["channel", "id", "subs", "videos", "avg", "best", "latest"];
      process.stdout.write(renderTable(rows, cols, { right: ["subs", "videos", "avg", "best"], flex: "channel", labels: { avg: "AVG OUTLIER", best: "BEST" } }));
      if (page.data.some((c) => c.tracked)) ctx.info("• tracked by the refresh pipeline");
    }
    ctx.info(`${grouped(page.total)} channels${page.nextCursor ? `\nnext cursor: ${page.nextCursor}` : ""}`);
  },
};

export default command;
