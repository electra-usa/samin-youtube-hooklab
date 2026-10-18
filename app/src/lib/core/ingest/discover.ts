// Discovery: finds channels the library lacks. Rotates search queries (the active user's
// channel topics and niches from data/app.db first, then two phrases per library niche)
// through ScrapeCreators search (this week's uploads, most popular first), and keeps
// channels whose video beats their size: views / subscribers >= HOOKLAB_DISCOVER_MIN_RATIO.
// Kept channels go to library_channels, so the refresh rotation polls them from then on.
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { libraryReader } from "./reader.ts";
import { appDbPath } from "../paths.ts";
import { scCanSpend, scChannel, scSearch, ScrapeCreatorsError, type ScVideo } from "./scrapecreators.ts";
import { ingestSettings } from "./settings.ts";
import { fetchFeed } from "./rss.ts";
import { errorMessage, nowIso } from "./util.ts";
import { fetchChannelPage } from "./youtube-page.ts";
import type { LibraryWriter } from "./writer.ts";

const NICHE_QUERIES: Record<string, string[]> = {
  "Anime & Manga": ["anime", "manga"],
  Art: ["drawing tutorial", "painting"],
  Automotive: ["car review", "car build"],
  "Beauty & Fashion": ["makeup", "fashion haul"],
  Careers: ["career advice", "job interview tips"],
  "Comedy & Sketch": ["comedy sketch", "funny skit"],
  "Crafting & Sewing": ["sewing", "crafts diy"],
  "Education & Study Tips": ["study tips", "how to learn faster"],
  "Engineering & Maker": ["engineering project", "maker build"],
  "Farming & Gardening": ["gardening", "homestead"],
  "Film & Cinema": ["movie analysis", "film review"],
  Finance: ["personal finance", "investing"],
  Fitness: ["workout", "build muscle"],
  "Food & Drink": ["recipe", "cooking"],
  Gaming: ["gaming", "video game"],
  "Geopolitics & Economics": ["economy explained", "geopolitics"],
  "Graphic Design": ["graphic design", "logo design"],
  Health: ["health tips", "nutrition"],
  History: ["history documentary", "ancient history"],
  "Home & DIY": ["home renovation", "diy home"],
  "Language Learning": ["language learning", "learn spanish"],
  Legal: ["lawyer explains", "legal advice"],
  Lifestyle: ["day in my life", "lifestyle vlog"],
  "Marketing & Business": ["small business", "marketing strategy"],
  "Music Education": ["guitar lesson", "music theory"],
  "Music Entertainment": ["music video reaction", "song breakdown"],
  "News & Politics": ["politics", "news analysis"],
  Outdoors: ["camping", "hiking"],
  Parenting: ["parenting tips", "mom life"],
  "Personal Development & Motivation": ["self improvement", "motivation"],
  "Pets & Animals": ["dog training", "animals"],
  "Photography & Videography": ["photography tips", "filmmaking"],
  "Pop Culture": ["celebrity news", "pop culture"],
  Productivity: ["productivity", "notion setup"],
  "Real Estate": ["real estate investing", "buying a house"],
  Relationships: ["relationship advice", "dating advice"],
  "Religion & Spirituality": ["bible study", "spirituality"],
  Science: ["science explained", "physics"],
  "Social Media & Content Creation": ["youtube growth", "content creation"],
  "Sports Education": ["basketball training", "golf tips"],
  "Sports Entertainment": ["nba", "football highlights"],
  Technology: ["tech review", "ai tools"],
  "Toys & Collecting": ["collecting", "lego"],
  Travel: ["travel vlog", "travel guide"],
  "True Crime": ["true crime", "unsolved case"],
};

type PoolEntry = { query: string; source: "channel_profile" | "niche"; intervalHours: number };

/** The active user's channel topics and niches (data/app.db), read-only. */
function profileQueries(): string[] {
  const file = appDbPath();
  if (!fs.existsSync(file)) return [];
  let db: DatabaseSync | null = null;
  try {
    db = new DatabaseSync(file, { readOnly: true });
    const row = db
      .prepare(
        `SELECT p.profile_json FROM channel_profiles p JOIN user_channels u ON u.id = p.user_channel_id
         ORDER BY u.is_active DESC, p.updated_at DESC LIMIT 1`,
      )
      .get() as { profile_json: string } | undefined;
    if (!row) return [];
    const profile = JSON.parse(row.profile_json) as { primaryNiches?: unknown; topics?: unknown; profile?: { topics?: unknown } };
    const list = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && !!x.trim()) : []);
    const topics = [...list(profile.topics), ...list(profile.profile?.topics)];
    const niches = list(profile.primaryNiches).flatMap((n) => NICHE_QUERIES[n] ?? [n]);
    return [...new Set([...topics, ...niches].map((q) => q.trim().toLowerCase()))].slice(0, 12);
  } catch {
    return [];
  } finally {
    db?.close();
  }
}

function contentLanguages(): string[] {
  const file = appDbPath();
  if (!fs.existsSync(file)) return [];
  let db: DatabaseSync | null = null;
  try {
    db = new DatabaseSync(file, { readOnly: true });
    const row = db.prepare("SELECT value FROM settings WHERE key = 'contentLanguages'").get() as { value: string } | undefined;
    const langs = row ? (JSON.parse(row.value) as unknown) : [];
    return Array.isArray(langs) ? langs.filter((l): l is string => typeof l === "string") : [];
  } catch {
    return [];
  } finally {
    db?.close();
  }
}

/** Mostly Latin letters: a cheap stand-in for "English-language" when that is the only content language. */
const latinTitle = (title: string) => {
  const letters = [...title].filter((ch) => /\p{L}/u.test(ch));
  if (!letters.length) return true;
  return letters.filter((ch) => /[A-Za-zÀ-ɏ]/.test(ch)).length / letters.length >= 0.8;
};

function pickQueries(writer: LibraryWriter, count: number): string[] {
  const pool: PoolEntry[] = [
    ...profileQueries().map((query) => ({ query, source: "channel_profile" as const, intervalHours: 24 })),
    ...Object.values(NICHE_QUERIES).flat().map((query) => ({ query, source: "niche" as const, intervalHours: 24 * 7 })),
  ];
  const now = Date.now();
  return writer.write((db) => {
    const insert = db.prepare("INSERT OR IGNORE INTO discovery_queries (query, source) VALUES (?, ?)");
    for (const p of pool) insert.run(p.query, p.source);
    const state = new Map(
      (db.prepare("SELECT query, last_run_at FROM discovery_queries").all() as { query: string; last_run_at: string | null }[]).map((r) => [r.query, r.last_run_at]),
    );
    const seen = new Set<string>();
    return pool
      .filter((p) => !seen.has(p.query) && seen.add(p.query))
      .map((p, i) => {
        const last = state.get(p.query);
        const due = last ? (now - Date.parse(last)) / (p.intervalHours * 3_600_000) : 1_000 - i * 0.01;
        return { query: p.query, due };
      })
      .filter((p) => p.due >= 1)
      .sort((a, b) => b.due - a.due)
      .slice(0, count)
      .map((p) => p.query);
  });
}

export type DiscoveredChannel = { channelId: string; name: string | null; subscriberCount: number | null; videoViews: number; ratio: number; query: string };

export type DiscoverResult = { queries: string[]; candidates: number; checked: number; added: DiscoveredChannel[]; errors: string[] };

export async function discoverChannels(
  writer: LibraryWriter,
  opts: { queries: number; runId: number | null; signal?: AbortSignal; log?: (m: string) => void },
): Promise<DiscoverResult> {
  const settings = ingestSettings();
  const result: DiscoverResult = { queries: [], candidates: 0, checked: 0, added: [], errors: [] };
  if (!scCanSpend()) {
    result.errors.push("discovery skipped: ScrapeCreators key missing or daily budget used up");
    return result;
  }
  const latinOnly = (() => {
    const langs = contentLanguages();
    return langs.length > 0 && langs.every((l) => l.toLowerCase().startsWith("en"));
  })();
  const known = (() => {
    const db = libraryReader();
    const ids = db
      .prepare(
        `SELECT channel_id FROM channels UNION SELECT channel_id FROM library_channels
         UNION SELECT channel_id FROM discovered_channels WHERE checked_at >= ?`,
      )
      .all(new Date(Date.now() - 30 * 86_400_000).toISOString()) as { channel_id: string }[];
    return new Set(ids.map((r) => r.channel_id));
  })();

  for (const query of pickQueries(writer, opts.queries)) {
    if (opts.signal?.aborted || !scCanSpend()) break;
    result.queries.push(query);
    let videos: ScVideo[] = [];
    try {
      videos = await scSearch(query, { uploadDate: "this_week", sortBy: "popular", type: "videos", runId: opts.runId, signal: opts.signal });
    } catch (err) {
      result.errors.push(`search "${query}": ${errorMessage(err)}`);
      if (err instanceof ScrapeCreatorsError && err.code !== "http") break;
      continue;
    }
    // Best video per unknown channel.
    const best = new Map<string, ScVideo>();
    for (const v of videos) {
      const id = v.channel?.id;
      if (!id || known.has(id) || (v.views ?? 0) < settings.discoverMinViews) continue;
      if (latinOnly && !latinTitle(`${v.title} ${v.channel?.title ?? ""}`)) continue;
      if ((best.get(id)?.views ?? -1) < (v.views ?? 0)) best.set(id, v);
    }
    result.candidates += best.size;
    let added = 0;
    const picks = [...best.values()].sort((a, b) => (b.views ?? 0) - (a.views ?? 0)).slice(0, 6);
    for (const v of picks) {
      const channelId = v.channel?.id;
      if (opts.signal?.aborted || !channelId) break;
      known.add(channelId);
      if (latinOnly) {
        // One English-looking title isn't enough; check the channel's own recent uploads (free).
        const feed = await fetchFeed(channelId, "long", opts.signal);
        const titles = feed.ok ? feed.entries.map((e) => e.title) : [v.title];
        const share = titles.filter(latinTitle).length / Math.max(1, titles.length);
        if (share < 0.7 || !latinTitle(v.channel?.title ?? "")) {
          writer.write((db) =>
            db
              .prepare(
                `INSERT INTO discovered_channels (channel_id, status, query, video_id, video_views, checked_at) VALUES (?, 'language', ?, ?, ?, ?)
                 ON CONFLICT(channel_id) DO UPDATE SET status = 'language', checked_at = excluded.checked_at`,
              )
              .run(channelId, query, v.videoId, v.views ?? 0, nowIso()),
          );
          continue;
        }
      }
      let identity: { name: string | null; handle: string | null; avatar: string | null; subscriberCount: number | null } | null = null;
      try {
        identity = scCanSpend() ? await scChannel({ channelId }, { cacheMaxAge: "30d", runId: opts.runId, signal: opts.signal }) : null;
      } catch (err) {
        result.errors.push(`channel ${channelId}: ${errorMessage(err)}`);
      }
      identity ??= await fetchChannelPage(channelId, opts.signal);
      result.checked++;
      const subs = identity?.subscriberCount ?? null;
      const views = v.views ?? 0;
      const ratio = subs ? views / Math.max(subs, 1_000) : 0;
      const keep = subs != null && subs >= 1_000 && ratio >= settings.discoverMinRatio;
      const now = nowIso();
      writer.write((db) => {
        db.prepare(
          `INSERT INTO discovered_channels (channel_id, status, query, video_id, video_views, subscriber_count, ratio, checked_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(channel_id) DO UPDATE SET status = excluded.status, query = excluded.query, video_id = excluded.video_id,
             video_views = excluded.video_views, subscriber_count = excluded.subscriber_count, ratio = excluded.ratio, checked_at = excluded.checked_at`,
        ).run(channelId, keep ? "added" : "rejected", query, v.videoId, views, subs, ratio, now);
        if (keep) {
          db.prepare(
            `INSERT INTO library_channels (channel_id, handle, name, avatar, subscriber_count, added_at)
             VALUES (?, ?, ?, ?, ?, ?)
             ON CONFLICT(channel_id) DO UPDATE SET subscriber_count = excluded.subscriber_count,
               name = COALESCE(name, excluded.name), handle = COALESCE(handle, excluded.handle), avatar = COALESCE(avatar, excluded.avatar)`,
          ).run(
            channelId,
            identity?.handle ?? (v.channel?.handle ? `@${v.channel.handle.replace(/^@/, "")}` : null),
            identity?.name ?? v.channel?.title ?? null,
            identity?.avatar ?? v.channel?.thumbnail ?? null,
            subs,
            now,
          );
          db.prepare(
            "INSERT INTO channel_poll_state (channel_id, subs_checked_at) VALUES (?, ?) ON CONFLICT(channel_id) DO UPDATE SET subs_checked_at = excluded.subs_checked_at, paused = 0",
          ).run(channelId, now);
        }
      });
      if (keep) {
        added++;
        result.added.push({ channelId, name: identity?.name ?? v.channel?.title ?? null, subscriberCount: subs, videoViews: views, ratio, query });
        opts.log?.(`discovered ${identity?.name ?? channelId} (${views.toLocaleString("en-US")} views on ${subs?.toLocaleString("en-US")} subscribers)`);
      }
    }
    const now = nowIso();
    writer.write((db) =>
      db
        .prepare("UPDATE discovery_queries SET last_run_at = ?, runs = runs + 1, candidates = candidates + ?, added = added + ? WHERE query = ?")
        .run(now, best.size, added, query),
    );
  }
  return result;
}
