import { parseFlags } from "../args.ts";
import { libraryStats } from "../core.ts";
import { ago, bar, bold, day, grouped, percent, renderRecord, renderTable, stamp } from "../format.ts";
import type { Command } from "../types.ts";

const command: Command = {
  name: "stats",
  summary: "Library totals: videos, channels, tiers, niches, triggers, formats, last refresh",
  usage: `Usage: hooklab stats [--all]

  --all   list every niche and click trigger (default: top 12 of each)

--json prints the full stats object; --csv/--jsonl print one row per breakdown entry
(section, key, label, count).

Examples
  hooklab stats
  hooklab stats --json | jq .totals`,
  async run(argv, ctx) {
    const { values } = parseFlags(argv, { all: { type: "boolean" } }, { positionals: false });
    const s = libraryStats();
    if (ctx.format === "json") {
      ctx.print(s as unknown as Record<string, unknown>);
      return;
    }
    if (ctx.format !== "table") {
      ctx.print(
        [
          ...Object.entries(s.totals).map(([key, count]) => ({ section: "totals", key, label: key, count })),
          ...s.byTier.map((t) => ({ section: "tier", key: t.id, label: t.label, count: t.count })),
          { section: "tier", key: "unscored", label: "No score", count: s.unscored },
          ...s.bySource.map((x) => ({ section: "source", key: x.source, label: x.source, count: x.count })),
          ...s.byTitleFormat.map((x) => ({ section: "titleFormat", key: x.frame ?? "", label: x.titleFormat ?? "Other", count: x.count })),
          ...s.byNiche.map((x) => ({ section: "niche", key: x.niche, label: x.niche, count: x.count })),
          ...s.byTrigger.map((x) => ({ section: "trigger", key: x.trigger, label: x.trigger, count: x.count })),
        ],
        ["section", "key", "label", "count"],
      );
      return;
    }

    const t = s.totals;
    const out = process.stdout;
    const r = s.refresh;
    out.write(`${bold("HookLab library")}\n`);
    out.write(
      renderRecord([
        ["Videos", `${grouped(t.videos)}${t.shorts ? ` (${grouped(t.longform)} long-form, ${grouped(t.shorts)} Shorts)` : ""}`],
        ["Channels", `${grouped(t.channels)}${t.trackedChannels ? ` · ${grouped(t.trackedChannels)} tracked by the refresh pipeline` : ""}`],
        ["Published", `${day(s.dateRange.oldest)} → ${day(s.dateRange.newest)} · ${grouped(t.publishedLast7Days)} in the last 7 days · ${grouped(t.publishedLast30Days)} in the last 30`],
        ["Rebuilt", s.builtAt ? `${stamp(s.builtAt)} (${ago(s.builtAt)})` : "never"],
        [
          "Last refresh",
          r?.lastStartedAt
            ? `${stamp(r.lastFinishedAt ?? r.lastStartedAt)} · ${r.lastStatus ?? "?"}${r.lastNewVideos != null ? ` · +${grouped(r.lastNewVideos)} videos` : ""}${r.lastNewOutliers != null ? ` · +${grouped(r.lastNewOutliers)} outliers` : ""} · ${grouped(r.runs)} runs`
            : "no refresh runs yet (hooklab refresh)",
        ],
      ]),
    );

    const section = (title: string, rows: { label: string; extra?: string; count: number }[]) => {
      const max = Math.max(...rows.map((x) => x.count), 0);
      const table = rows.map((x) => ({ name: x.label, range: x.extra ?? "", videos: grouped(x.count), share: percent(x.count, t.videos), "": bar(x.count, max, 24) }));
      const cols = rows.some((x) => x.extra) ? ["name", "range", "videos", "share", ""] : ["name", "videos", "share", ""];
      out.write(`\n${renderTable(table, cols, { labels: { name: title }, right: ["videos", "share"] })}`);
    };
    section(
      "TIER",
      [...s.byTier].reverse().map((x) => ({ label: x.label, extra: x.scoreLabel, count: x.count })),
    );
    section(
      "TITLE FORMAT",
      s.byTitleFormat.map((x) => ({ label: x.titleFormat ?? "Other", count: x.count })),
    );
    const limit = values.all ? Infinity : 12;
    section(
      `NICHE${values.all ? "" : " (top 12)"}`,
      s.byNiche.slice(0, limit).map((x) => ({ label: x.niche, count: x.count })),
    );
    section(
      `CLICK TRIGGER${values.all ? "" : " (top 12)"}`,
      s.byTrigger.slice(0, limit).map((x) => ({ label: x.trigger, count: x.count })),
    );
    section(
      "SOURCE",
      s.bySource.map((x) => ({ label: x.source, count: x.count })),
    );
  },
};

export default command;
