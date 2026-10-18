import { UsageError, parseFlags } from "../args.ts";
import { ago, bold, compact, dim, grouped, renderRecord, score, stamp } from "../format.ts";
import type { CliContext, Command } from "../types.ts";
import { RefreshBusyError, listRuns, runRefresh, type RefreshRun, type RefreshSummary } from "../../../app/src/lib/core/ingest/refresh.ts";
import { startRefreshLoop } from "../../../app/src/lib/core/ingest/scheduler.ts";
import { ingestSettings, type TaggingMode } from "../../../app/src/lib/core/ingest/settings.ts";
import { refreshStatus } from "../../../app/src/lib/core/ingest/status.ts";

const int = (v: string | undefined, name: string, min = 0): number | undefined => {
  if (v == null) return undefined;
  const n = Number(v);
  if (!Number.isInteger(n) || n < min) throw new UsageError(`--${name} needs a whole number${min ? ` of at least ${min}` : ""}.`);
  return n;
};

function printSummary(s: RefreshSummary, ctx: CliContext) {
  if (ctx.format !== "table") {
    ctx.print(s as unknown as Record<string, unknown>);
    return;
  }
  process.stdout.write(
    renderRecord([
      ["Run", `${s.id} · ${s.status}${s.dryRun ? " (dry run: nothing written)" : ""} · ${Math.round(s.durationMs / 1000)}s`],
      ["Channels", `${grouped(s.channelsPolled)} polled of ${grouped(s.channelsPlanned)} planned · ${grouped(s.requests)} feed requests`],
      ["Videos", `${grouped(s.newVideos)} new · ${grouped(s.updatedVideos)} refreshed`],
      ["New outliers", grouped(s.newOutliers)],
      ["Enriched", `${grouped(s.enriched)} durations`],
      ["Tagged", `${grouped(s.tagged)}${s.aiCostUsd ? ` · ~$${s.aiCostUsd.toFixed(3)}` : ""}`],
      ["Discovered", s.discovered.length ? s.discovered.map((d) => `${d.name ?? d.channelId} (${d.ratio}x subs)`).join(", ") : grouped(s.discoveredChannels)],
      ["Credits", `${grouped(s.creditsUsed)} ScrapeCreators`],
      ["Errors", s.errors ? `${s.errors}: ${s.errorSample.slice(0, 3).join(" | ")}` : "none"],
    ]),
  );
  if (s.topOutliers.length) {
    process.stdout.write(`\n${bold("Top outliers this run")}\n`);
    ctx.print(
      s.topOutliers.map((t) => ({
        score: score(t.outlierScore),
        views: compact(t.views),
        channel: t.channelName,
        title: t.title,
        published: ago(t.publishAt),
        kind: t.isShort ? "short" : "long",
      })),
      ["score", "views", "channel", "title", "published", "kind"],
    );
  }
}

function runRow(r: RefreshRun) {
  return {
    id: r.id,
    started: stamp(r.startedAt),
    status: r.status,
    trigger: r.trigger,
    channels: r.channelsPolled,
    new: r.newVideos,
    refreshed: r.updatedVideos,
    outliers: r.newOutliers,
    tagged: r.tagged,
    discovered: r.discoveredChannels,
    credits: r.creditsUsed,
    errors: r.errors,
  };
}

const command: Command = {
  name: "refresh",
  summary: "Poll channels for new uploads, rescore outliers, tag and discover (the live pipeline)",
  usage: `Usage: hooklab refresh [options]            one run now
       hooklab refresh --loop [--every 60]  keep running (the hosting worker)
       hooklab refresh status               running?, last run, next run, totals, credits
       hooklab refresh runs [--limit 20]    recent runs

Options
  --channels N        channels to poll (default HOOKLAB_REFRESH_CHANNELS or 300; most overdue first)
  --channel UC…       poll this channel now, due or not (repeatable)
  --concurrency N     parallel feed requests (default 6)
  --discover          also find new channels via ScrapeCreators search (--no-discover to skip)
  --queries N         discovery queries this run (default 3; 1 credit each, plus channel lookups)
  --tagging MODE      outliers (default) | all | off: Claude tags new videos
  --no-enrich         skip duration lookups for new outliers
  --dry-run           fetch and score, write nothing
  --loop              run every --every minutes until stopped (Ctrl-C finishes the current batch)
  --every N           minutes between run starts in --loop mode (default 60)

Examples
  hooklab refresh --channels 200
  hooklab refresh --dry-run --channels 20
  hooklab refresh --loop --every 60 --discover
  hooklab refresh status --json`,
  async run(argv, ctx) {
    const { values, positionals } = parseFlags(argv, {
      channels: { type: "string" },
      channel: { type: "string", multiple: true },
      concurrency: { type: "string" },
      discover: { type: "boolean" },
      "no-discover": { type: "boolean" },
      queries: { type: "string" },
      tagging: { type: "string" },
      "no-enrich": { type: "boolean" },
      "dry-run": { type: "boolean" },
      loop: { type: "boolean" },
      every: { type: "string" },
      limit: { type: "string" },
    });
    const sub = positionals[0];
    if (sub === "status") {
      const s = refreshStatus();
      if (ctx.format !== "table") return void ctx.print(s as unknown as Record<string, unknown>);
      const t = s.totals;
      process.stdout.write(
        renderRecord([
          ["Running", s.running ? `yes · run ${s.run?.id ?? "?"} (${s.lock?.owner}) since ${ago(s.lock?.startedAt)}` : "no"],
          ["Last run", s.lastRun ? `${s.lastRun.id} ${s.lastRun.status} · ${ago(s.lastRun.finishedAt ?? s.lastRun.startedAt)} · ${s.lastRun.newVideos} new, ${s.lastRun.newOutliers} new outliers` : "never"],
          ["Next run", s.nextRunAt ? `${stamp(s.nextRunAt)} (${s.scheduler?.owner}, every ${s.scheduler?.everyMinutes} min)` : dim("no scheduler running")],
          ["Library", `${grouped(t.videos)} videos · ${grouped(t.liveVideos)} tracked live (${grouped(t.pipelineVideos)} found by the pipeline)`],
          ["Last 24h", `${grouped(t.newVideos24h)} new videos · ${grouped(t.newOutliers24h)} new outliers · ${grouped(t.channelsPolled24h)} channels polled`],
          ["Channels", `${grouped(t.libraryChannels)} added from YouTube`],
          ["Credits", `${t.creditsRemaining == null ? "unknown" : grouped(t.creditsRemaining)} left · ${t.creditsUsed24h}/${t.dailyCreditBudget} used in 24h`],
        ]),
      );
      return;
    }
    if (sub === "runs") {
      const runs = listRuns(int(values.limit, "limit", 1) ?? 20);
      if (ctx.format !== "table") return void ctx.print(runs as unknown as Record<string, unknown>[]);
      ctx.print(runs.map(runRow), ["id", "started", "status", "trigger", "channels", "new", "refreshed", "outliers", "tagged", "discovered", "credits", "errors"]);
      return;
    }
    if (sub) throw new UsageError(`Unknown subcommand "${sub}" (use status or runs, or no subcommand to run).`);

    const tagging = values.tagging as TaggingMode | undefined;
    if (tagging && !["outliers", "all", "off"].includes(tagging)) throw new UsageError("--tagging is outliers, all or off.");
    const discover = values.discover ? true : values["no-discover"] ? false : undefined;
    const base = {
      channels: int(values.channels, "channels"),
      channelIds: values.channel?.flatMap((c) => c.split(",")).map((c) => c.trim()).filter(Boolean),
      concurrency: int(values.concurrency, "concurrency", 1),
      discover,
      discoverQueries: int(values.queries, "queries", 1),
      tagging,
      enrich: values["no-enrich"] ? false : undefined,
      dryRun: !!values["dry-run"],
    };

    if (values.loop) {
      if (base.dryRun) throw new UsageError("--loop and --dry-run don't mix.");
      const every = int(values.every, "every", 1) ?? 60;
      const log = (m: string) => ctx.info(`${new Date().toISOString()} ${m}`);
      const loop = startRefreshLoop({ everyMinutes: every, trigger: "worker", channels: base.channels, discover, log });
      await new Promise<void>((resolve) => {
        const stop = (signal: string) => {
          log(`${signal}: finishing the current batch, then exiting`);
          loop.stop().then(resolve, resolve);
        };
        process.once("SIGINT", () => stop("SIGINT"));
        process.once("SIGTERM", () => stop("SIGTERM"));
      });
      return 0;
    }

    const settings = ingestSettings();
    ctx.info(
      dim(
        `${base.dryRun ? "Dry run: " : ""}polling up to ${base.channelIds?.length ?? base.channels ?? settings.channelsPerRun} channels · tagging ${base.dryRun ? "off" : (tagging ?? settings.tagging)}`,
        process.stderr,
      ),
    );
    const controller = new AbortController();
    const onSigint = () => {
      ctx.info("Stopping after the current batch…");
      controller.abort();
    };
    process.once("SIGINT", onSigint);
    try {
      const summary = await runRefresh({ ...base, trigger: "cli", signal: controller.signal, log: (m) => ctx.info(dim(m, process.stderr)) });
      printSummary(summary, ctx);
      return summary.status === "failed" ? 1 : 0;
    } catch (err) {
      if (err instanceof RefreshBusyError) {
        ctx.info(err.message);
        return 3;
      }
      throw err;
    } finally {
      process.off("SIGINT", onSigint);
    }
  },
};

export default command;
