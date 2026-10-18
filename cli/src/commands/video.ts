import { UsageError, parseFlags } from "../args.ts";
import { TIERS, getVideo } from "../core.ts";
import { ago, bold, clock, compact, day, grouped, renderRecord } from "../format.ts";
import type { Command } from "../types.ts";
import { outlierCell } from "../videos-view.ts";

const command: Command = {
  name: "video",
  summary: "Show one video: stats, tier, niches, click triggers, title format",
  usage: `Usage: hooklab video <videoId | YouTube URL | row id>

Accepts watch, youtu.be, /shorts/ and /embed/ links.

Examples
  hooklab video mtiOK2QG9Q0
  hooklab video "https://www.youtube.com/watch?v=mtiOK2QG9Q0" --json`,
  async run(argv, ctx) {
    const { positionals } = parseFlags(argv, {});
    const ref = positionals.join(" ").trim();
    if (!ref) throw new UsageError("Pass a video id or YouTube URL.");
    const v = getVideo(ref);
    if (!v) {
      ctx.info(`No video in the library matches "${ref}".`);
      return 1;
    }
    if (ctx.format !== "table") {
      ctx.print(v as unknown as Record<string, unknown>);
      return;
    }
    const tier = TIERS.find((t) => t.id === v.tier);
    process.stdout.write(`${bold(v.title)}\n`);
    process.stdout.write(
      renderRecord([
        ["Channel", `${v.channelName ?? "?"}${v.channelId ? ` (${v.channelId})` : ""}${v.subscriberCount != null ? ` · ${compact(v.subscriberCount)} subscribers` : ""}`],
        ["Outlier", `${outlierCell(v)}${tier ? ` · ${tier.label} (${tier.scoreLabel})` : ""}`],
        ["Views", grouped(v.views)],
        ["Published", v.publishAt ? `${day(v.publishAt)} · ${ago(v.publishAt)}` : ""],
        ["Duration", `${clock(v.durationSeconds)}${v.isShort ? " · Short" : ""}`],
        ["Format", [v.titleFormat, v.frame && v.frame !== v.titleFormat?.toLowerCase() ? `frame ${v.frame}` : "", v.secondaryFrame ? `also ${v.secondaryFrame}` : ""].filter(Boolean).join(" · ")],
        ["POV", v.pov ?? ""],
        ["Niches", v.niches.join(", ")],
        ["Triggers", v.clickTriggers.join(", ")],
        ["Video types", v.videoTypes.join(", ")],
        ["Newsletter", v.featuredInNewsletter ? "featured" : ""],
        ["URL", v.videoUrl],
        ["Thumbnail", v.thumbnail],
        ["Row", `${v.id} · source ${v.source}${v.titleLength != null ? ` · title ${v.titleLength} characters` : ""}`],
      ]),
    );
  },
};

export default command;
