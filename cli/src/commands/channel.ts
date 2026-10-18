import { UsageError, parseFlags } from "../args.ts";
import { getChannel } from "../core.ts";
import { ago, bold, compact, day, dim, grouped, percent, renderRecord, score, stamp } from "../format.ts";
import type { Command } from "../types.ts";
import { videoTable } from "../videos-view.ts";

const command: Command = {
  name: "channel",
  summary: "Show one channel: stats, tier mix, top niches and triggers, best videos",
  usage: `Usage: hooklab channel <UC… id | @handle | channel URL | name> [--videos N]

  --videos N   how many top videos (by outlier score) to include (default 10, max 100)

Names match ignoring case, spaces and punctuation; a unique partial name works too.

Examples
  hooklab channel UCLKPca3kwwd-B59HNr-_lvA
  hooklab channel "AI Engineer" --videos 5
  hooklab channel @IBMTechnology --json`,
  async run(argv, ctx) {
    const { values, positionals } = parseFlags(argv, { videos: { type: "string" } });
    const ref = positionals.join(" ").trim();
    if (!ref) throw new UsageError("Pass a channel id, @handle, URL or name.");
    const detail = getChannel(ref, { videos: values.videos });
    if (!detail) {
      ctx.info(`No channel in the library matches "${ref}". Try \`hooklab channels ${ref.replace(/^@/, "")}\`.`);
      return 1;
    }
    if (ctx.format === "json") {
      ctx.print(detail as unknown as Record<string, unknown>);
      return;
    }
    if (ctx.format !== "table") {
      // JSONL / CSV: the top videos as rows (the channel itself is in --json).
      ctx.print(detail.topVideos as Record<string, unknown>[]);
      return;
    }
    const c = detail.channel;
    const b = detail.breakdown;
    process.stdout.write(`${bold(c.channelName ?? c.channelId)}${c.handle ? ` ${dim(c.handle)}` : ""}\n`);
    const scored = b.byTier.reduce((n, t) => n + t.count, 0);
    const tierMix = b.byTier
      .filter((t) => t.count)
      .reverse()
      .map((t) => `${t.label} ${t.count} (${percent(t.count, scored)})`)
      .join(" · ");
    process.stdout.write(
      renderRecord([
        ["Channel", `${c.channelId} · ${c.channelUrl}`],
        ["Subscribers", grouped(c.subscriberCount)],
        ["In library", `${grouped(c.videoCount)} videos${b.firstPublishAt ? ` · ${day(b.firstPublishAt)} → ${day(c.latestPublishAt)}` : ""}${c.latestPublishAt ? ` (latest ${ago(c.latestPublishAt)})` : ""}`],
        ["Total views", c.totalViews != null ? `${compact(c.totalViews)} (${grouped(c.totalViews)})` : ""],
        ["Outliers", `best ${score(c.maxOutlierScore)} · average ${score(c.avgOutlierScore)} · median ${score(b.medianOutlierScore)}`],
        ["Tiers", tierMix],
        ["Niches", b.topNiches.map((n) => `${n.niche} (${n.count})`).join(", ")],
        ["Triggers", b.topTriggers.map((t) => `${t.trigger} (${t.count})`).join(", ")],
        ["Formats", b.titleFormats.map((f) => `${f.titleFormat} (${f.count})`).join(", ")],
        ["Tracked", c.tracked ? `yes · added ${stamp(c.addedAt)}${c.lastSyncedAt ? ` · synced ${ago(c.lastSyncedAt)}` : ""}${c.lastError ? ` · last error: ${c.lastError}` : ""}` : ""],
      ]),
    );
    if (detail.topVideos.length) {
      process.stdout.write(`\n${bold("Top videos by outlier score")}\n`);
      process.stdout.write(videoTable(detail.topVideos));
    }
  },
};

export default command;
