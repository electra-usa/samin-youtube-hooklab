import { UsageError, parseFlags } from "../args.ts";
import { compact, dim, grouped, renderRecord } from "../format.ts";
import type { Command } from "../types.ts";
import { RefreshBusyError, runRefresh } from "../../../app/src/lib/core/ingest/refresh.ts";
import { scBudget } from "../../../app/src/lib/core/ingest/scrapecreators.ts";
import type { TaggingMode } from "../../../app/src/lib/core/ingest/settings.ts";

const command: Command = {
  name: "discover",
  summary: "Find channels the library lacks (ScrapeCreators search) and add the ones beating their size",
  usage: `Usage: hooklab discover [--queries N] [--tagging outliers|all|off]

Runs N rotating search queries (your channel's topics and niches first, then two phrases per
library niche) for this week's most popular uploads, and keeps channels whose video has at least
HOOKLAB_DISCOVER_MIN_RATIO (default 1) views per subscriber. Kept channels are added to the
library and polled right away. Costs about 1 credit per query plus up to 6 channel lookups each
(cached lookups are free), within SCRAPECREATORS_DAILY_CREDITS.

  --queries N     how many queries (default 3)
  --tagging MODE  tag the new channels' outliers with Claude (default outliers)

Examples
  hooklab discover
  hooklab discover --queries 2 --json`,
  async run(argv, ctx) {
    const { values } = parseFlags(argv, { queries: { type: "string" }, tagging: { type: "string" } }, { positionals: false });
    const queries = values.queries == null ? 3 : Number(values.queries);
    if (!Number.isInteger(queries) || queries < 1) throw new UsageError("--queries needs a whole number of at least 1.");
    const tagging = values.tagging as TaggingMode | undefined;
    if (tagging && !["outliers", "all", "off"].includes(tagging)) throw new UsageError("--tagging is outliers, all or off.");
    const budget = scBudget();
    if (!budget.configured) {
      ctx.info("Discovery needs SCRAPECREATORS_API_KEY (app/.env.local).");
      return 1;
    }
    ctx.info(dim(`ScrapeCreators: ${budget.available} of ${budget.dailyBudget} daily credits available${budget.creditsRemaining != null ? `, ${grouped(budget.creditsRemaining)} left on the account` : ""}`, process.stderr));
    try {
      const s = await runRefresh({ channels: 0, discover: true, discoverQueries: queries, tagging, trigger: "cli", log: (m) => ctx.info(dim(m, process.stderr)) });
      if (ctx.format !== "table") {
        ctx.print(s as unknown as Record<string, unknown>);
        return s.status === "failed" ? 1 : 0;
      }
      process.stdout.write(
        renderRecord([
          ["Run", `${s.id} · ${s.status}`],
          ["Added", `${s.discovered.length} channels`],
          ["Their videos", `${grouped(s.newVideos)} new · ${grouped(s.newOutliers)} new outliers · ${grouped(s.tagged)} tagged`],
          ["Credits", grouped(s.creditsUsed)],
          ["Errors", s.errors ? s.errorSample.slice(0, 3).join(" | ") : "none"],
        ]),
      );
      if (s.discovered.length) {
        process.stdout.write("\n");
        ctx.print(
          s.discovered.map((d) => ({ channel: d.name ?? d.channelId, id: d.channelId, "views per sub": `${d.ratio}x` })),
          ["channel", "id", "views per sub"],
        );
      }
      if (s.topOutliers.length) {
        process.stdout.write("\n");
        ctx.print(
          s.topOutliers.map((t) => ({ score: `${t.outlierScore?.toFixed(1)}x`, views: compact(t.views), channel: t.channelName, title: t.title })),
          ["score", "views", "channel", "title"],
        );
      }
      return s.status === "failed" ? 1 : 0;
    } catch (err) {
      if (err instanceof RefreshBusyError) {
        ctx.info(`${err.message} Try again when it finishes.`);
        return 3;
      }
      throw err;
    }
  },
};

export default command;
