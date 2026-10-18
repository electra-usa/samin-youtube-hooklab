import { UsageError, parseFlags } from "../args.ts";
import { ago, bold, dim, grouped, renderRecord } from "../format.ts";
import type { CliContext, Command } from "../types.ts";
import {
  addLibraryChannel,
  listLibraryChannels,
  removeLibraryChannel,
  syncLibraryChannel,
  type BackfillResult,
  type LibraryChannel,
} from "../../../app/src/lib/core/ingest/library.ts";

const row = (c: LibraryChannel) => ({
  channel: c.name ?? c.channelId,
  handle: c.handle,
  id: c.channelId,
  subscribers: c.subscriberCount,
  videos: c.videos,
  outliers: c.outliers,
  source: c.source,
  added: ago(c.addedAt),
  polled: ago(c.lastPolledAt),
  error: c.lastError,
});

function printBackfill(b: BackfillResult | null) {
  if (!b) return;
  process.stdout.write(
    renderRecord([
      ["Fetched", `${grouped(b.videos)} uploads${b.deep ? " (RSS + one ScrapeCreators page)" : " (RSS)"}`],
      ["Stored", `${grouped(b.newVideos)} new · ${grouped(b.updatedVideos)} refreshed · ${grouped(b.outliers)} recent outliers`],
      ...(b.error ? ([["Warning", b.error]] as [string, string][]) : []),
    ]),
  );
}

async function add(argv: string[], ctx: CliContext) {
  const { values, positionals } = parseFlags(argv, { "no-backfill": { type: "boolean" }, shallow: { type: "boolean" } });
  const inputs = positionals.map((p) => p.trim()).filter(Boolean);
  if (!inputs.length) throw new UsageError("Pass one or more channels: @handle, channel URL or UC… id.");
  const results: Record<string, unknown>[] = [];
  let failures = 0;
  for (const input of inputs) {
    try {
      const { channel, created, backfill } = await addLibraryChannel(input, { backfill: !values["no-backfill"], deep: !values.shallow });
      if (ctx.format !== "table") {
        results.push({ ...channel, created, backfill } as unknown as Record<string, unknown>);
        continue;
      }
      process.stdout.write(`${bold(created ? "Added" : "Already in the library:")} ${channel.name ?? channel.channelId} ${dim(channel.handle ?? "")}\n`);
      process.stdout.write(
        renderRecord([
          ["Channel", `${channel.channelId} · https://www.youtube.com/channel/${channel.channelId}`],
          ["Subscribers", grouped(channel.subscriberCount)],
          ["In library", `${grouped(channel.videos)} videos · ${grouped(channel.outliers)} at 2x+`],
        ]),
      );
      printBackfill(backfill);
    } catch (err) {
      // One bad handle shouldn't stop the rest of the batch.
      if (inputs.length === 1) throw err;
      failures++;
      ctx.info(`Skipped ${input}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  if (ctx.format !== "table") ctx.print(results.length === 1 && inputs.length === 1 ? results[0] : results);
  if (failures) process.exitCode = 1;
}

const command: Command = {
  name: "library",
  summary: "Manage channels added from YouTube: add, list, remove, sync",
  usage: `Usage: hooklab library add <@handle | channel URL | UC… id>… [--shallow] [--no-backfill]
       hooklab library list
       hooklab library remove <UC… id> [--purge]
       hooklab library sync <UC… id | @handle> [--deep]

add      resolves each channel (public channel page first, ScrapeCreators as a fallback), adds it
         to the library and backfills it: its RSS feeds plus one ScrapeCreators page of ~30
         uploads with exact views and durations (1 credit; --shallow skips it).
         Added channels are polled more often than the rest of the library.
list     channels added from YouTube (by you or by discovery) with video counts.
remove   stops tracking a channel (also pauses polling for channels from the export);
         --purge also deletes the videos the pipeline stored for it.
sync     polls one channel's feeds now; --deep adds a ScrapeCreators page (1 credit).

Examples
  hooklab library add @veritasium @mkbhd
  hooklab library add https://www.youtube.com/@kurzgesagt --shallow
  hooklab library list --json
  hooklab library remove UCHnyfMqiRRG1u-2MsSQLbXA`,
  async run(argv, ctx) {
    const [sub, ...rest] = argv;
    if (sub === "add") return void (await add(rest, ctx));
    if (sub === "list" || sub === "ls") {
      parseFlags(rest, {}, { positionals: false });
      const channels = listLibraryChannels();
      if (ctx.format !== "table") return void ctx.print(channels as unknown as Record<string, unknown>[]);
      if (!channels.length) return void ctx.info("No channels added yet. Try `hooklab library add @handle`.");
      ctx.print(channels.map(row), ["channel", "handle", "subscribers", "videos", "outliers", "source", "added", "polled", "error"]);
      return;
    }
    if (sub === "remove" || sub === "rm") {
      const { values, positionals } = parseFlags(rest, { purge: { type: "boolean" } });
      const id = positionals[0]?.trim();
      if (!id) throw new UsageError("Pass the channel id (UC…). `hooklab library list` shows them.");
      const r = removeLibraryChannel(id, { purge: !!values.purge });
      if (ctx.format !== "table") return void ctx.print({ channelId: id, ...r });
      ctx.info(`${r.removed ? "Removed" : "Not in library_channels; paused"} ${id}${r.purged ? ` and deleted ${r.purged} pipeline videos` : ""}. Polling is paused for it.`);
      return;
    }
    if (sub === "sync") {
      const { values, positionals } = parseFlags(rest, { deep: { type: "boolean" } });
      const input = positionals.join(" ").trim();
      if (!input) throw new UsageError("Pass a channel id or @handle.");
      const b = await syncLibraryChannel(input, { deep: !!values.deep });
      if (ctx.format !== "table") return void ctx.print(b as unknown as Record<string, unknown>);
      process.stdout.write(`${bold("Synced")} ${b.channelId}\n`);
      printBackfill(b);
      return b.error && !b.videos ? 1 : 0;
    }
    throw new UsageError(sub ? `Unknown subcommand "${sub}".` : "Pick a subcommand: add, list, remove or sync.");
  },
};

export default command;
