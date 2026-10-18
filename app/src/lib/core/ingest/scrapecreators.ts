// ScrapeCreators (paid, 1 credit per request; cached channel lookups cost 0). Used sparingly:
// subscriber counts for channels the library doesn't know, durations for new outliers, and
// discovery. Every call is written to scrapecreators_calls, which enforces a rolling 24-hour
// budget (SCRAPECREATORS_DAILY_CREDITS, default 100) and remembers credits_remaining.
// The API key comes from SCRAPECREATORS_API_KEY and is never logged.
import { openLibraryWriter } from "../library-db.ts";
import { libraryReader } from "./reader.ts";
import { ingestSettings } from "./settings.ts";
import { CHANNEL_ID_RE, hoursAgoIso, nowIso, sleep } from "./util.ts";

const BASE = "https://api.scrapecreators.com";

export type ScErrorCode = "no_key" | "budget" | "auth" | "http" | "network";

export class ScrapeCreatorsError extends Error {
  readonly code: ScErrorCode;
  readonly status: number;
  constructor(code: ScErrorCode, message: string, status = 0) {
    super(message);
    this.name = "ScrapeCreatorsError";
    this.code = code;
    this.status = status;
  }
}

export const scConfigured = () => !!process.env.SCRAPECREATORS_API_KEY?.trim();

let reserved = 0;
let disabledUntil = 0;

export type ScBudget = {
  configured: boolean;
  dailyBudget: number;
  usedLast24h: number;
  available: number;
  creditsRemaining: number | null;
  creditsRemainingAt: string | null;
};

export function scBudget(): ScBudget {
  const db = libraryReader();
  const budget = ingestSettings().scrapeCreatorsDailyCredits;
  let used = 0;
  let last: { credits_remaining: number; at: string } | undefined;
  try {
    used = Number(
      (db.prepare("SELECT COALESCE(SUM(credits_charged), 0) AS n FROM scrapecreators_calls WHERE at >= ?").get(hoursAgoIso(24)) as { n: number }).n,
    );
    last = db
      .prepare("SELECT credits_remaining, at FROM scrapecreators_calls WHERE credits_remaining IS NOT NULL ORDER BY id DESC LIMIT 1")
      .get() as typeof last;
  } catch {
    // The ledger table appears with the first writer migration.
  }
  const remaining = last?.credits_remaining ?? null;
  const available = Math.max(0, Math.min(budget - used - reserved, remaining ?? Number.POSITIVE_INFINITY));
  return {
    configured: scConfigured(),
    dailyBudget: budget,
    usedLast24h: used,
    available: Number.isFinite(available) ? available : 0,
    creditsRemaining: remaining,
    creditsRemainingAt: last?.at ?? null,
  };
}

/** Whether a paid call is allowed right now (key set, budget left, not disabled after an auth error). */
export function scCanSpend(credits = 1): boolean {
  return scConfigured() && Date.now() >= disabledUntil && scBudget().available >= credits;
}

function record(endpoint: string, status: number, charged: number, remaining: number | null, runId: number | null) {
  const db = openLibraryWriter();
  try {
    db.prepare(
      "INSERT INTO scrapecreators_calls (at, endpoint, status, credits_charged, credits_remaining, run_id) VALUES (?, ?, ?, ?, ?, ?)",
    ).run(nowIso(), endpoint, status, charged, remaining, runId);
  } finally {
    db.close();
  }
}

type ScOptions = { runId?: number | null; signal?: AbortSignal };

async function scGet(path: string, params: Record<string, string | undefined>, opts: ScOptions = {}): Promise<Record<string, unknown>> {
  const key = process.env.SCRAPECREATORS_API_KEY?.trim();
  if (!key) throw new ScrapeCreatorsError("no_key", "SCRAPECREATORS_API_KEY is not set.");
  if (Date.now() < disabledUntil) throw new ScrapeCreatorsError("auth", "ScrapeCreators is paused after an authorization error.");
  if (scBudget().available < 1) throw new ScrapeCreatorsError("budget", "ScrapeCreators daily credit budget is used up.");
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v != null && v !== "") qs.set(k, v);
  const url = `${BASE}${path}?${qs.toString()}`;
  reserved += 1;
  try {
    for (let attempt = 0; ; attempt++) {
      let res: Response;
      try {
        const timeout = AbortSignal.timeout(45_000);
        res = await fetch(url, {
          headers: { "x-api-key": key, Accept: "application/json" },
          signal: opts.signal ? AbortSignal.any([timeout, opts.signal]) : timeout,
        });
      } catch (err) {
        if (attempt < 1 && !opts.signal?.aborted) {
          await sleep(2_000, opts.signal);
          continue;
        }
        throw new ScrapeCreatorsError("network", `ScrapeCreators request failed: ${err instanceof Error ? err.message : String(err)}`);
      }
      const body = (await res.json().catch(() => null)) as Record<string, unknown> | null;
      const remaining = typeof body?.credits_remaining === "number" ? body.credits_remaining : null;
      // Error bodies (e.g. a 404 for an unknown handle) can omit credits_charged yet still cost
      // a credit; count one whenever the API reports a balance, so the budget stays conservative.
      const charged = typeof body?.credits_charged === "number" ? body.credits_charged : res.ok || remaining != null ? 1 : 0;
      record(path, res.status, charged, remaining, opts.runId ?? null);
      if ((res.status === 429 || res.status >= 500) && attempt < 1) {
        await sleep(3_000, opts.signal);
        continue;
      }
      if (res.status === 401 || res.status === 402 || res.status === 403) {
        disabledUntil = Date.now() + 30 * 60_000;
        throw new ScrapeCreatorsError("auth", `ScrapeCreators rejected the request (HTTP ${res.status}).`, res.status);
      }
      if (!res.ok || !body || body.success === false) {
        const message = typeof body?.message === "string" ? body.message : typeof body?.error === "string" ? body.error : `HTTP ${res.status}`;
        throw new ScrapeCreatorsError("http", `ScrapeCreators ${path}: ${message}`, res.status);
      }
      return body;
    }
  } finally {
    reserved -= 1;
  }
}

const str = (v: unknown) => (typeof v === "string" && v.trim() ? v : null);
const int = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? Math.round(v) : null);

export type ScChannel = {
  channelId: string;
  name: string | null;
  handle: string | null;
  avatar: string | null;
  subscriberCount: number | null;
  videoCount: number | null;
  cached: boolean;
};

/** Channel identity and subscriber count. Cached answers (cache_max_age) cost 0 credits. */
export async function scChannel(
  ref: { channelId?: string; handle?: string; url?: string },
  opts: ScOptions & { cacheMaxAge?: "1d" | "3d" | "7d" | "14d" | "30d" } = {},
): Promise<ScChannel | null> {
  const body = await scGet(
    "/v1/youtube/channel",
    { channelId: ref.channelId, handle: ref.handle?.replace(/^@/, ""), url: ref.url, cache_max_age: opts.cacheMaxAge ?? "7d" },
    opts,
  );
  const channelId = str(body.channelId);
  if (!channelId || !CHANNEL_ID_RE.test(channelId)) return null;
  const sources = ((body.avatar as { image?: { sources?: { url?: string; width?: number }[] } } | null)?.image?.sources ?? [])
    .filter((s) => s.url)
    .sort((a, b) => (b.width ?? 0) - (a.width ?? 0));
  const handle = str(body.handle);
  return {
    channelId,
    name: str(body.name),
    handle: handle ? (handle.startsWith("@") ? handle : `@${handle}`) : null,
    avatar: sources[0]?.url ?? null,
    subscriberCount: int(body.subscriberCount),
    videoCount: int(body.videoCount),
    cached: body.cached === true,
  };
}

export type ScVideo = {
  videoId: string;
  title: string;
  views: number | null;
  /** ScrapeCreators derives this from "3 weeks ago", so it is only day/month accurate. */
  publishedAt: string | null;
  lengthSeconds: number | null;
  channel: { id: string; title: string | null; handle: string | null; thumbnail: string | null } | null;
};

function toVideos(list: unknown): ScVideo[] {
  if (!Array.isArray(list)) return [];
  const out: ScVideo[] = [];
  for (const raw of list as Record<string, unknown>[]) {
    const videoId = str(raw?.id);
    if (!videoId || !/^[\w-]{11}$/.test(videoId)) continue;
    const ch = raw.channel as Record<string, unknown> | undefined;
    const chId = str(ch?.id);
    out.push({
      videoId,
      title: str(raw.title) ?? "",
      views: int(raw.viewCountInt),
      publishedAt: str(raw.publishedTime),
      lengthSeconds: int(raw.lengthSeconds),
      channel: chId ? { id: chId, title: str(ch?.title), handle: str(ch?.handle), thumbnail: str(ch?.thumbnail) } : null,
    });
  }
  return out;
}

/** The channel's latest (or most popular) long-form uploads, ~30 per page, with exact views and durations. */
export async function scChannelVideos(channelId: string, opts: ScOptions & { sort?: "latest" | "popular" } = {}): Promise<ScVideo[]> {
  const body = await scGet("/v1/youtube/channel-videos", { channelId, sort: opts.sort ?? "latest" }, opts);
  return toVideos(body.videos);
}

/** YouTube search. Video results carry the uploading channel. */
export async function scSearch(
  query: string,
  opts: ScOptions & { uploadDate?: "today" | "this_week" | "this_month" | "this_year"; sortBy?: "relevance" | "popular"; type?: "videos" | "shorts" } = {},
): Promise<ScVideo[]> {
  const body = await scGet(
    "/v1/youtube/search",
    { query, uploadDate: opts.uploadDate ?? "this_week", sortBy: opts.sortBy ?? "popular", type: opts.type ?? "videos" },
    opts,
  );
  return toVideos(body.videos);
}
