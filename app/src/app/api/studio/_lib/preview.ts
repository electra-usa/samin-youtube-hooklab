import "server-only";
import { appDb } from "@/lib/db/app";
import { library, type LibraryVideoRow } from "@/lib/db/library";

// Real videos to surround Studio combos with in the YouTube feed mock: recent
// long-form library videos from the active channel's primary niches ("Your niche"),
// or a random recent mix ("Random").

export type PreviewMode = "niche" | "random";

export function primaryNiches(userChannelId: string | null): string[] {
  if (!userChannelId) return [];
  const row = appDb().prepare("SELECT profile_json FROM channel_profiles WHERE user_channel_id = ?").get(userChannelId) as
    | { profile_json: string }
    | undefined;
  if (!row) return [];
  try {
    const p = JSON.parse(row.profile_json) as { primaryNiches?: unknown; profile?: { primaryNiches?: unknown } };
    const list = p.primaryNiches ?? p.profile?.primaryNiches;
    return Array.isArray(list) ? list.filter((n): n is string => typeof n === "string") : [];
  } catch {
    return [];
  }
}

function shuffle<T>(items: T[]): T[] {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function hiddenChannels(): Set<string> {
  const rows = appDb().prepare("SELECT channel_id FROM hidden_channels").all() as { channel_id: string }[];
  return new Set(rows.map((r) => r.channel_id));
}

/** Library time reference: the export lags real time, so windows count back from its newest video. */
function newestPublish(): number {
  const row = library().prepare("SELECT MAX(publish_at) AS t FROM videos").get() as { t: string | null };
  return row.t ? Date.parse(row.t) : Date.now();
}

const BASE = "SELECT v.* FROM videos v WHERE v.is_short = 0 AND COALESCE(v.duration_seconds, 0) >= 60";

/** One video per channel where possible, so the feed doesn't repeat creators. */
function spread(rows: LibraryVideoRow[], limit: number, hidden: Set<string>): LibraryVideoRow[] {
  const seen = new Set<string>();
  const first: LibraryVideoRow[] = [];
  const rest: LibraryVideoRow[] = [];
  for (const r of rows) {
    if (r.channel_id && hidden.has(r.channel_id)) continue;
    const key = r.channel_id ?? r.id;
    (seen.has(key) ? rest : first).push(r);
    seen.add(key);
  }
  return [...first, ...rest].slice(0, limit);
}

export function nicheVideos(niches: string[], limit: number): LibraryVideoRow[] {
  if (!niches.length) return [];
  const newest = newestPublish();
  const hidden = hiddenChannels();
  const marks = niches.map(() => "?").join(",");
  for (const days of [7, 30, 120, 3650]) {
    const since = new Date(newest - days * 86_400_000).toISOString();
    const rows = library()
      .prepare(
        `${BASE} AND v.publish_at >= ? AND EXISTS (SELECT 1 FROM video_niches n WHERE n.video_row_id = v.id AND n.niche IN (${marks}))
         ORDER BY v.publish_at DESC LIMIT 600`,
      )
      .all(since, ...niches) as LibraryVideoRow[];
    if (rows.length >= limit || days === 3650) return spread(shuffle(rows), limit, hidden);
  }
  return [];
}

export function randomVideos(limit: number): LibraryVideoRow[] {
  const since = new Date(newestPublish() - 30 * 86_400_000).toISOString();
  const rows = library()
    .prepare(`${BASE} AND v.publish_at >= ? AND COALESCE(v.views, 0) >= 1000 ORDER BY random() LIMIT ?`)
    .all(since, Math.max(limit * 3, 60)) as LibraryVideoRow[];
  return spread(rows, limit, hiddenChannels());
}
