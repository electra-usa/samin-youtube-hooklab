import { UsageError, parseFlags } from "../args.ts";
import { libraryStats, taxonomy } from "../core.ts";
import { grouped, renderTable } from "../format.ts";
import type { Command } from "../types.ts";

const KINDS = ["triggers", "niches", "tiers", "formats"] as const;
type Kind = (typeof KINDS)[number];

const ALIASES: Record<string, Kind> = {
  trigger: "triggers", triggers: "triggers", "click-triggers": "triggers", clicktriggers: "triggers",
  niche: "niches", niches: "niches",
  tier: "tiers", tiers: "tiers",
  format: "formats", formats: "formats", "title-formats": "formats", titleformats: "formats",
};

const command: Command = {
  name: "taxonomy",
  summary: "Filter values: click triggers, niches, tiers, title formats (with video counts)",
  usage: `Usage: hooklab taxonomy [triggers|niches|tiers|formats]

Without an argument, prints all four lists. These are the values --trigger, --niche, --tier and
--format-type accept (matching ignores case and punctuation: "marketing-business" works).

Examples
  hooklab taxonomy triggers
  hooklab taxonomy niches --csv
  hooklab taxonomy --json`,
  async run(argv, ctx) {
    const { positionals } = parseFlags(argv, {});
    const kind = positionals[0] ? ALIASES[positionals[0].toLowerCase()] : null;
    if (positionals[0] && !kind) throw new UsageError(`Unknown list "${positionals[0]}". Use one of: ${KINDS.join(", ")}.`);
    const tax = taxonomy();
    const stats = libraryStats();
    const niche = new Map(stats.byNiche.map((n) => [n.niche, n.count]));
    const trigger = new Map(stats.byTrigger.map((n) => [n.trigger, n.count]));
    const tier = new Map(stats.byTier.map((n) => [n.id, n.count]));
    const format = new Map(stats.byTitleFormat.map((n) => [n.titleFormat, n.count]));

    const lists: Record<Kind, Record<string, unknown>[]> = {
      triggers: tax.clickTriggers.map((name) => ({ trigger: name, videos: trigger.get(name) ?? 0 })),
      niches: tax.niches.map((name) => ({ niche: name, videos: niche.get(name) ?? 0 })),
      tiers: [...tax.tiers].reverse().map((t) => ({ id: t.id, label: t.label, score: t.scoreLabel, min: t.min, max: t.max, videos: tier.get(t.id) ?? 0 })),
      formats: tax.titleFormats.map((f) => ({ format: f.name, frame: f.frame, description: f.description, videos: format.get(f.name) ?? 0 })),
    };

    if (kind) {
      if (ctx.format === "table") {
        const rows = lists[kind].map((r) => ({ ...r, videos: grouped(r.videos as number) }));
        process.stdout.write(renderTable(rows, Object.keys(rows[0] ?? {}), { right: ["videos", "min", "max"] }));
      } else ctx.print(lists[kind]);
      return;
    }
    if (ctx.format === "json") {
      ctx.print({ ...tax, counts: { tiers: lists.tiers, titleFormats: lists.formats, niches: lists.niches, clickTriggers: lists.triggers } });
      return;
    }
    if (ctx.format !== "table") {
      ctx.print(
        KINDS.flatMap((k) =>
          lists[k].map((r) => ({ list: k, value: String(r.trigger ?? r.niche ?? r.id ?? r.format), label: String(r.label ?? r.trigger ?? r.niche ?? r.format), videos: r.videos })),
        ),
        ["list", "value", "label", "videos"],
      );
      return;
    }
    for (const k of KINDS) {
      const rows = lists[k].map((r) => ({ ...r, videos: grouped(r.videos as number) }));
      const cols = k === "tiers" ? ["id", "label", "score", "videos"] : k === "formats" ? ["format", "frame", "videos", "description"] : Object.keys(rows[0] ?? {});
      process.stdout.write(`${renderTable(rows, cols, { right: ["videos"] })}\n`);
    }
  },
};

export default command;
