// How video lists print in every format (search, top, channel).
import type { VideoPage, VideoRecord } from "./core.ts";
import { compact, day, grouped, paint, renderTable, score } from "./format.ts";
import type { CliContext } from "./types.ts";

const TIER_STYLE: Record<string, "magenta" | "blue" | "green" | "yellow" | "dim"> = {
  mega_bangers: "magenta",
  bangers: "blue",
  great: "green",
  above_avg: "yellow",
  flops: "dim",
  below_avg: "dim",
};

export function outlierCell(v: Partial<VideoRecord>): string {
  const text = score(v.outlierScore);
  const style = v.tier ? TIER_STYLE[v.tier] : undefined;
  return style ? paint(style, text) : text;
}

/** Table rows for videos: score, views, channel size, date, channel, title, id. */
export function videoTable(videos: Partial<VideoRecord>[]): string {
  const rows = videos.map((v) => ({
    outlier: outlierCell(v),
    views: compact(v.views),
    subs: compact(v.subscriberCount),
    published: day(v.publishAt),
    channel: v.channelName ?? "",
    title: v.title ?? "",
    video: v.videoId ?? "",
  }));
  return renderTable(rows, ["outlier", "views", "subs", "published", "channel", "title", "video"], {
    right: ["outlier", "views", "subs"],
    flex: "title",
  });
}

/** One page of a video listing; the next cursor (and total, when counted) go to stderr. */
export function printVideoPage(page: VideoPage, ctx: CliContext, opts: { fields?: string[] | null; hint?: string } = {}) {
  const fields = opts.fields?.length ? opts.fields : null;
  if (ctx.format === "json") {
    ctx.print({ data: page.data, nextCursor: page.nextCursor, hasMore: page.hasMore, ...(page.total != null ? { total: page.total } : {}) });
  } else if (ctx.format === "table" && !fields) {
    if (page.data.length) process.stdout.write(videoTable(page.data));
    else ctx.info("No videos match.");
  } else {
    ctx.print(page.data as Record<string, unknown>[], fields ?? undefined);
  }
  if (page.total != null) ctx.info(`${grouped(page.total)} matching videos${page.mode ? ` (${page.mode} search, sorted by ${page.sort})` : ` (sorted by ${page.sort})`}`);
  if (page.nextCursor) ctx.info(`next cursor: ${page.nextCursor}${opts.hint ? `\n${opts.hint}` : ""}`);
}
