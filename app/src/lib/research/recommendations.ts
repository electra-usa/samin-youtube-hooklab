import "server-only";
import { activeChannel, appDb } from "@/lib/db/app";
import { library, toOutlierVideo, type LibraryVideoRow, type OutlierVideo } from "@/lib/db/library";
import type { VideoType } from "./filters";
import { hiddenChannelIds } from "./app-data";
import { topicMatch, topicTerms } from "./text";
import { VIDEO_COLUMNS } from "./videos";

// "Videos you might like" on Bookmarks. Three candidate pools, interleaved:
//   in_profile - strong recent outliers in the active channel's primary niches (channel profile)
//   topic      - titles sharing the channel's own recurring topics (plus bookmarked titles' topics)
//   explore    - strong recent outliers from any niche, for variety
// One video per channel; bookmarked, hidden, own-channel and recently shown videos are skipped.

type Bucket = "in_profile" | "topic" | "explore";
export type Recommendation = OutlierVideo & { recommendationBucket: Bucket; matchedNiche: string | null };

const NOISE = new Set(
  `tutorial tutorials insane forever changed change full course courses practical use uses case cases build builds sell better people fix
  expensive chance endless possibilities favorite testing test master minutes hours crazy secret new free easy ultimate guide step steps
  works working work instead stop cancel subscription last first part review reviews beginners beginner way ways link bio send dm comment`.split(/\s+/),
);
// Exploration stays away from news and tragedy-driven niches.
const EXPLORE_SKIP_NICHES = ["Geopolitics & Economics", "Legal", "News & Politics", "Pop Culture", "True Crime"];
const DAY = 86_400_000;

type Profile = { niches: string[]; terms: string[]; ownChannelId: string | null };
const profileCache = new Map<string, { at: number; profile: Profile }>();

function channelProfile(type: VideoType): Profile {
  const channel = activeChannel();
  if (!channel) return { niches: [], terms: [], ownChannelId: null };
  const key = `${channel.id}:${type}`;
  const hit = profileCache.get(key);
  if (hit && Date.now() - hit.at < 10 * 60_000) return hit.profile;
  const db = appDb();
  const row = db.prepare("SELECT profile_json FROM channel_profiles WHERE user_channel_id = ?").get(channel.id) as { profile_json: string } | undefined;
  let niches: string[] = [];
  try {
    const profile = row ? (JSON.parse(row.profile_json) as { primaryNiches?: unknown }) : null;
    if (Array.isArray(profile?.primaryNiches)) niches = profile.primaryNiches.filter((n): n is string => typeof n === "string");
  } catch {
    niches = [];
  }
  // Same-format titles: Shorts captions are often boilerplate that says nothing about long-form topics.
  const titlesOf = (kind: string | null) =>
    (
      db
        .prepare(`SELECT title FROM channel_videos WHERE channel_id = ? ${kind ? "AND type = ?" : ""} ORDER BY published_at DESC LIMIT 120`)
        .all(...(kind ? [channel.channelId, kind] : [channel.channelId])) as { title: string }[]
    ).map((r) => r.title);
  let titles = titlesOf(type === "shorts" ? "shorts" : "longform");
  if (titles.length < 5) titles = titlesOf(null);
  const profile = { niches, terms: distinctiveTerms(titles, 12), ownChannelId: channel.channelId };
  profileCache.set(key, { at: Date.now(), profile });
  return profile;
}

/** Terms that recur in these titles but are uncommon across the library (tf x idf), minus template words. */
function distinctiveTerms(titles: string[], max: number): string[] {
  const tf = new Map<string, number>();
  for (const t of titles) {
    for (const term of new Set(topicTerms(t, { fromTitle: true, max: 30 }))) {
      if (NOISE.has(term) || term.length < 3) continue;
      tf.set(term, (tf.get(term) ?? 0) + 1);
    }
  }
  const lib = library();
  const total = (lib.prepare("SELECT max(rowid) AS n FROM videos").get() as { n: number | null }).n || 1;
  const df = lib.prepare("SELECT count(*) AS n FROM videos_fts WHERE videos_fts MATCH ?");
  const candidates = [...tf.entries()]
    .filter(([, count]) => (titles.length <= 5 || count >= 2) && (titles.length < 8 || count / titles.length <= 0.35))
    .sort((a, b) => b[1] - a[1])
    .slice(0, 60);
  const scored: { term: string; score: number }[] = [];
  for (const [term, count] of candidates) {
    let docs = 0;
    try {
      docs = (df.get(`title : "${term.replace(/"/g, '""')}"`) as { n: number }).n;
    } catch {
      continue;
    }
    if (docs) scored.push({ term, score: count * Math.log(total / (1 + docs)) });
  }
  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, max)
    .map((s) => s.term);
}

const sinceIso = (days: number) => new Date(Date.now() - days * DAY).toISOString();

/** Strong but believable outliers first: capped score x reach, fading with age. */
function appeal(r: LibraryVideoRow): number {
  const ageDays = r.publish_at ? (Date.now() - Date.parse(r.publish_at)) / DAY : 365;
  const recency = ageDays <= 30 ? 1 : Math.max(0.55, 1 - (ageDays - 30) / 330);
  return Math.sqrt(Math.min(r.outlier_score ?? 0, 25)) * Math.log10(Math.min(Math.max(r.views ?? 0, 10), 2_000_000)) * recency;
}

export function bookmarkRecommendations(opts: { type: VideoType; limit: number; exclude: string[]; seedVideoIds: string[] }) {
  const db = library();
  const profile = channelProfile(opts.type);
  const bookmarked = appDb().prepare("SELECT video_id, video_json FROM bookmarks").all() as { video_id: string; video_json: string }[];
  const skipVideos = new Set([...opts.exclude, ...bookmarked.map((b) => b.video_id)]);
  const skipChannels = new Set(hiddenChannelIds());
  if (profile.ownChannelId) skipChannels.add(profile.ownChannelId);
  const isShort = opts.type === "shorts" ? 1 : 0;

  // Bookmarked titles (the client's seeds first) sharpen the topic pool.
  const seedSet = new Set(opts.seedVideoIds);
  const seedTitles = bookmarked
    .filter((b) => !seedSet.size || seedSet.has(b.video_id))
    .slice(0, 12)
    .map((b) => {
      try {
        return (JSON.parse(b.video_json) as { title?: string }).title ?? "";
      } catch {
        return "";
      }
    })
    .filter(Boolean);
  const topicWords = [...new Set([...distinctiveTerms(seedTitles, 6), ...profile.terms])].slice(0, 16);

  const keep = (rows: LibraryVideoRow[]) =>
    rows.filter((r) => !skipVideos.has(r.video_id) && !(r.channel_id && skipChannels.has(r.channel_id)) && (r.outlier_score ?? 0) < 999);
  const byAppeal = (rows: LibraryVideoRow[]) => rows.sort((a, b) => appeal(b) - appeal(a));

  const nichePool = (days: number) =>
    profile.niches.length
      ? keep(
          db
            .prepare(
              `SELECT ${VIDEO_COLUMNS} FROM videos v
               WHERE v.id IN (SELECT video_row_id FROM video_niches WHERE niche IN (SELECT value FROM json_each(?)))
                 AND v.is_short = ? AND v.outlier_score >= 4 AND v.views >= 10000 AND v.publish_at >= ?`,
            )
            .all(JSON.stringify(profile.niches), isShort, sinceIso(days)) as LibraryVideoRow[],
        )
      : [];
  let inProfile = nichePool(90);
  if (inProfile.length < 24) inProfile = nichePool(365);
  byAppeal(inProfile);

  const match = topicMatch(topicWords);
  const topic = match
    ? keep(
        db
          .prepare(
            `SELECT ${VIDEO_COLUMNS}, CAST(bm25(videos_fts, 1.0, 0.0) AS INTEGER) AS band FROM videos_fts f JOIN videos v ON v.rowid = f.rowid
             WHERE videos_fts MATCH ? AND v.is_short = ? AND v.outlier_score >= 3 AND v.views >= 5000 AND v.publish_at >= ?
             ORDER BY band LIMIT 300`,
          )
          .all(match, isShort, sinceIso(365)) as (LibraryVideoRow & { band: number })[],
      ).sort((a, b) => (a as LibraryVideoRow & { band: number }).band - (b as LibraryVideoRow & { band: number }).band || appeal(b) - appeal(a))
    : [];

  const explore = byAppeal(
    keep(
      db
        .prepare(
          `SELECT ${VIDEO_COLUMNS} FROM videos v
           WHERE v.is_short = ? AND v.outlier_score >= 8 AND v.views >= 50000 AND v.publish_at >= ?
             AND ${EXPLORE_SKIP_NICHES.map(() => "instr(v.niches, ?) = 0").join(" AND ")} AND instr(v.click_triggers, '"News"') = 0`,
        )
        .all(isShort, sinceIso(60), ...EXPLORE_SKIP_NICHES.map((n) => JSON.stringify(n))) as LibraryVideoRow[],
    ),
  );

  // Spread the niche pool across the profile's niches instead of the single strongest one.
  const byNiche = new Map<string, LibraryVideoRow[]>();
  for (const r of inProfile) {
    const niche = (JSON.parse(r.niches || "[]") as string[]).find((n) => profile.niches.includes(n)) ?? "";
    byNiche.set(niche, [...(byNiche.get(niche) ?? []), r]);
  }
  const queues = [...byNiche.values()];
  const roundRobin: LibraryVideoRow[] = [];
  for (let i = 0; queues.some((q) => q.length > i); i++) for (const q of queues) if (q[i]) roundRobin.push(q[i]);

  const pools: Record<Bucket, LibraryVideoRow[]> = { in_profile: roundRobin, topic, explore };
  const pattern: Bucket[] = ["in_profile", "topic", "in_profile", "explore", "in_profile", "topic", "in_profile", "explore"];
  const usedVideos = new Set<string>();
  const usedChannels = new Set<string>();
  const out: Recommendation[] = [];
  const take = (bucket: Bucket) => {
    const pool = pools[bucket];
    while (pool.length) {
      const r = pool.shift()!;
      if (usedVideos.has(r.video_id) || (r.channel_id && usedChannels.has(r.channel_id))) continue;
      usedVideos.add(r.video_id);
      if (r.channel_id) usedChannels.add(r.channel_id);
      const niches = JSON.parse(r.niches || "[]") as string[];
      out.push({
        ...toOutlierVideo(r),
        recommendationBucket: bucket,
        matchedNiche: bucket === "in_profile" ? niches.find((n) => profile.niches.includes(n)) ?? null : null,
      });
      return true;
    }
    return false;
  };
  for (let i = 0; out.length < opts.limit && i < opts.limit * 4; i++) {
    if (!take(pattern[i % pattern.length]) && !(["in_profile", "topic", "explore"] as const).some((b) => take(b))) break;
  }
  const remaining = Object.values(pools).reduce((n, pool) => n + pool.filter((r) => !usedVideos.has(r.video_id)).length, 0);
  return { status: "ready" as const, recommendations: out, hasMore: remaining > 0, basis: { niches: profile.niches, topics: topicWords } };
}
