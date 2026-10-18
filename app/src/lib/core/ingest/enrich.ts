// Fills what RSS doesn't carry for long-form videos that became outliers: duration. One
// ScrapeCreators channel-videos call per channel (it lists the channel's latest ~30 uploads
// with lengths, so it also fills that channel's other recent rows), within the daily budget;
// when credits are out, a capped number of free watch-page lookups.
import { libraryReader } from "./reader.ts";
import { scCanSpend, scChannelVideos, ScrapeCreatorsError } from "./scrapecreators.ts";
import { OUTLIER_THRESHOLD } from "./settings.ts";
import { errorMessage, isoDuration, mapLimit, nowIso } from "./util.ts";
import { fetchWatchPageDuration } from "./youtube-page.ts";
import type { LibraryWriter } from "./writer.ts";

export type EnrichResult = { enriched: number; calls: number; pages: number; errors: string[] };

type Target = { video_id: string; channel_id: string };

function saveDurations(writer: LibraryWriter, durations: Map<string, number>, attempted: string[]) {
  const now = nowIso();
  return writer.write((db) => {
    let filled = 0;
    for (const [videoId, seconds] of durations) {
      const r = db
        .prepare("UPDATE videos SET duration_seconds = ?, duration = ? WHERE video_id = ? AND duration_seconds IS NULL")
        .run(seconds, isoDuration(seconds), videoId);
      filled += Number(r.changes);
    }
    for (const videoId of attempted) db.prepare("UPDATE live_videos SET enriched_at = ? WHERE video_id = ?").run(now, videoId);
    return filled;
  });
}

export async function enrichOutliers(
  writer: LibraryWriter,
  opts: { runId: number | null; maxCalls: number; maxPages: number; signal?: AbortSignal; log?: (m: string) => void },
): Promise<EnrichResult> {
  const result: EnrichResult = { enriched: 0, calls: 0, pages: 0, errors: [] };
  const targets = libraryReader()
    .prepare(
      `SELECT lv.video_id, lv.channel_id FROM live_videos lv JOIN videos v ON v.id = lv.row_id
       WHERE lv.enriched_at IS NULL AND v.duration_seconds IS NULL AND v.is_short = 0 AND v.outlier_score >= ?
       ORDER BY v.outlier_score DESC LIMIT 300`,
    )
    .all(OUTLIER_THRESHOLD) as Target[];
  if (!targets.length) return result;

  const byChannel = new Map<string, string[]>();
  for (const t of targets) byChannel.set(t.channel_id, [...(byChannel.get(t.channel_id) ?? []), t.video_id]);
  const remaining = new Set(targets.map((t) => t.video_id));

  let stop = false;
  await mapLimit([...byChannel], 3, async ([channelId, videoIds]) => {
    if (stop || result.calls >= opts.maxCalls || opts.signal?.aborted || !scCanSpend()) return;
    try {
      result.calls++;
      const listing = await scChannelVideos(channelId, { runId: opts.runId, signal: opts.signal });
      const durations = new Map(listing.filter((v) => v.lengthSeconds != null).map((v) => [v.videoId, v.lengthSeconds as number]));
      const found = videoIds.filter((id) => durations.has(id));
      result.enriched += saveDurations(writer, durations, found);
      for (const id of found) remaining.delete(id);
    } catch (err) {
      result.errors.push(`duration lookup for ${channelId}: ${errorMessage(err)}`);
      if (err instanceof ScrapeCreatorsError && (err.code === "budget" || err.code === "auth" || err.code === "no_key")) stop = true;
    }
  });

  const pageTargets = [...remaining].slice(0, opts.maxPages);
  if (pageTargets.length && !opts.signal?.aborted) {
    const found = new Map<string, number>();
    await mapLimit(pageTargets, 3, async (videoId) => {
      const seconds = await fetchWatchPageDuration(videoId, opts.signal);
      result.pages++;
      if (seconds != null) found.set(videoId, seconds);
    });
    result.enriched += saveDurations(writer, found, pageTargets);
  }
  if (result.enriched) opts.log?.(`filled durations for ${result.enriched} videos (${result.calls} ScrapeCreators calls, ${result.pages} watch pages)`);
  return result;
}
