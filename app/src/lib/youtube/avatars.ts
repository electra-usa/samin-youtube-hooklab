import "server-only";
import fs from "node:fs";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { appDb, nowIso } from "@/lib/db/app";
import { library } from "@/lib/db/library";

// Channel avatars for the Studio feed mock. The exported library has no avatars, so
// they come from what we already know (followed channels, the account export) and
// otherwise from the channel page's og:image, cached in channel_avatars.

const SCHEMA = `CREATE TABLE IF NOT EXISTS channel_avatars (
  channel_id TEXT PRIMARY KEY, avatar TEXT, status TEXT NOT NULL, fetched_at TEXT NOT NULL
)`;
const ACCOUNT_DIR = process.env.ACCOUNT_EXPORT_DIR ?? path.resolve(process.cwd(), "..", "data", "account");
const RETRY_MS = 7 * 86_400_000;

let ready = false;

function db(): DatabaseSync {
  const d = appDb();
  if (!ready) {
    d.exec(SCHEMA);
    seed(d);
    ready = true;
  }
  return d;
}

/** Small avatar variant of a yt3 image URL. */
export const sizedAvatar = (url: string, size = 176) => url.replace(/=s\d+(-|$)/, `=s${size}$1`);

function seed(d: DatabaseSync) {
  const put = d.prepare("INSERT OR IGNORE INTO channel_avatars (channel_id, avatar, status, fetched_at) VALUES (?, ?, 'ok', ?)");
  const now = nowIso();
  for (const r of d.prepare("SELECT channel_id, avatar FROM followed_channels WHERE avatar IS NOT NULL").all() as { channel_id: string; avatar: string }[]) {
    put.run(r.channel_id, sizedAvatar(r.avatar), now);
  }
  for (const r of d.prepare("SELECT channel_id, avatar FROM user_channels WHERE avatar IS NOT NULL").all() as { channel_id: string; avatar: string }[]) {
    put.run(r.channel_id, sizedAvatar(r.avatar), now);
  }
  // The exported Studio feed carries avatars keyed by video; map them to channels via the library.
  for (const name of ["studio-preview-videos-niche", "studio-preview-videos-broad"]) {
    try {
      const doc = JSON.parse(fs.readFileSync(path.join(ACCOUNT_DIR, `${name}.json`), "utf8"));
      const videos = (doc.body ?? doc).videos as { videoId: string; Channel?: { channelAvatar?: string } }[];
      const find = library().prepare("SELECT channel_id FROM videos WHERE video_id = ? LIMIT 1");
      for (const v of videos ?? []) {
        const row = find.get(v.videoId) as { channel_id: string | null } | undefined;
        if (row?.channel_id && v.Channel?.channelAvatar) put.run(row.channel_id, sizedAvatar(v.Channel.channelAvatar), now);
      }
    } catch {
      // export not present
    }
  }
}

export function cachedAvatars(channelIds: string[]): Map<string, { avatar: string | null; status: string; fetchedAt: string }> {
  if (!channelIds.length) return new Map();
  const rows = db()
    .prepare(`SELECT * FROM channel_avatars WHERE channel_id IN (${channelIds.map(() => "?").join(",")})`)
    .all(...channelIds) as { channel_id: string; avatar: string | null; status: string; fetched_at: string }[];
  return new Map(rows.map((r) => [r.channel_id, { avatar: r.avatar, status: r.status, fetchedAt: r.fetched_at }]));
}

async function fetchAvatar(channelId: string): Promise<string | null> {
  const res = await fetch(`https://www.youtube.com/channel/${encodeURIComponent(channelId)}`, {
    headers: {
      "Accept-Language": "en-US,en;q=0.9",
      "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36",
    },
    signal: AbortSignal.timeout(8_000),
  });
  if (!res.ok || !res.body) return null;
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      buf += decoder.decode(value, { stream: true });
      const m = /<meta property="og:image" content="([^"]+)"/.exec(buf);
      if (m) return sizedAvatar(m[1].replace(/&amp;/g, "&"));
      if (total > 3_000_000) break;
      if (buf.length > 256_000) buf = buf.slice(-4_000);
    }
  } finally {
    reader.cancel().catch(() => {});
  }
  return null;
}

const g = globalThis as unknown as { __hooklabAvatarFetches?: Map<string, Promise<string | null>> };
const inflight = (g.__hooklabAvatarFetches ??= new Map());

function fetchAndCache(channelId: string): Promise<string | null> {
  const existing = inflight.get(channelId);
  if (existing) return existing;
  const job = fetchAvatar(channelId)
    .catch(() => null)
    .then((avatar) => {
      db()
        .prepare("INSERT OR REPLACE INTO channel_avatars (channel_id, avatar, status, fetched_at) VALUES (?, ?, ?, ?)")
        .run(channelId, avatar, avatar ? "ok" : "missing", nowIso());
      return avatar;
    })
    .finally(() => inflight.delete(channelId));
  inflight.set(channelId, job);
  return job;
}

/**
 * Avatars for these channels: cached ones immediately, unknown ones fetched with a
 * time budget. Fetches that miss the budget keep running and fill the cache.
 */
export async function resolveAvatars(channelIds: string[], { budgetMs = 2_500, concurrency = 6 } = {}): Promise<Map<string, string | null>> {
  const unique = [...new Set(channelIds.filter(Boolean))];
  const cached = cachedAvatars(unique);
  const out = new Map<string, string | null>();
  const todo: string[] = [];
  for (const id of unique) {
    const c = cached.get(id);
    if (c && (c.status === "ok" || Date.now() - Date.parse(c.fetchedAt) < RETRY_MS)) out.set(id, c.avatar);
    else todo.push(id);
  }
  if (todo.length) {
    let next = 0;
    const worker = async () => {
      while (next < todo.length) {
        const id = todo[next++];
        out.set(id, await fetchAndCache(id));
      }
    };
    const all = Promise.all(Array.from({ length: Math.min(concurrency, todo.length) }, worker));
    await Promise.race([all, new Promise((r) => setTimeout(r, budgetMs))]);
  }
  return out;
}
