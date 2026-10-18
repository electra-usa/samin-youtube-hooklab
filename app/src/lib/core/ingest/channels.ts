// Which channels a refresh polls. Candidates are every channel in the library (`channels`)
// plus the ones added from YouTube (`library_channels`). Each gets a polling interval from
// how recently it uploaded (the feeds' newest upload once polled, else the export's latest
// video), shortened for user-added, discovered and high-performing channels and stretched
// after errors. A run takes the most overdue channels first; never-polled channels are due
// immediately, user-added ones ahead of the rest.
import type { DatabaseSync } from "node:sqlite";
import { CHANNEL_ID_RE } from "./util.ts";

export type ChannelSource = "user" | "discovered" | "library";

export type Candidate = {
  channelId: string;
  name: string | null;
  source: ChannelSource;
  lastUploadAt: string | null;
  maxScore: number | null;
  lastPolledAt: string | null;
  errors: number;
  hasShorts: number | null;
  shortsCheckedAt: string | null;
  intervalHours: number;
  overdue: number;
};

type Row = {
  channel_id: string;
  name: string | null;
  latest_publish_at: string | null;
  max_outlier_score: number | null;
  user_added: number;
};

type StateRow = {
  channel_id: string;
  last_polled_at: string | null;
  last_upload_at: string | null;
  consecutive_errors: number;
  has_shorts: number | null;
  shorts_checked_at: string | null;
  paused: number;
};

const DAY = 86_400_000;

export function pollIntervalHours(c: Pick<Candidate, "source" | "lastUploadAt" | "maxScore" | "errors">, now = Date.now()): number {
  const age = c.lastUploadAt ? (now - Date.parse(c.lastUploadAt)) / DAY : Number.POSITIVE_INFINITY;
  let hours = age <= 3 ? 4 : age <= 14 ? 8 : age <= 45 ? 24 : age <= 180 ? 72 : 168;
  if (c.source === "user") hours = Math.max(1, hours / 3);
  else if (c.source === "discovered") hours = Math.max(2, hours / 2);
  if ((c.maxScore ?? 0) >= 10) hours *= 0.75;
  if (c.errors > 0) hours = Math.min(14 * 24, hours * 2 ** Math.min(c.errors, 5));
  return hours;
}

function neverPolledRank(c: Pick<Candidate, "source" | "lastUploadAt" | "maxScore">, now: number): number {
  if (c.source === "user") return 1000;
  if (c.source === "discovered") return 500;
  const age = c.lastUploadAt ? (now - Date.parse(c.lastUploadAt)) / DAY : Number.POSITIVE_INFINITY;
  return 2 + (age <= 7 ? 3 : age <= 30 ? 2 : age <= 180 ? 1 : 0) + ((c.maxScore ?? 0) >= 10 ? 0.5 : 0);
}

/** Every candidate with its interval and how overdue it is (1 = exactly due). */
export function listCandidates(db: DatabaseSync, now = Date.now()): Candidate[] {
  const rows = db
    .prepare(
      `SELECT channel_id, channel_name AS name, latest_publish_at, max_outlier_score, 0 AS user_added FROM channels
       UNION ALL
       SELECT channel_id, name, NULL, NULL, 1 FROM library_channels`,
    )
    .all() as Row[];
  const discovered = new Set(
    (db.prepare("SELECT channel_id FROM discovered_channels WHERE status = 'added'").all() as { channel_id: string }[]).map((r) => r.channel_id),
  );
  const states = new Map(
    (db.prepare("SELECT channel_id, last_polled_at, last_upload_at, consecutive_errors, has_shorts, shorts_checked_at, paused FROM channel_poll_state").all() as StateRow[]).map(
      (s) => [s.channel_id, s],
    ),
  );
  const merged = new Map<string, { name: string | null; latest: string | null; maxScore: number | null; user: boolean }>();
  for (const r of rows) {
    if (!CHANNEL_ID_RE.test(r.channel_id)) continue;
    const m = merged.get(r.channel_id) ?? { name: null, latest: null, maxScore: null, user: false };
    m.name ??= r.name;
    if (r.latest_publish_at && (!m.latest || r.latest_publish_at > m.latest)) m.latest = r.latest_publish_at;
    if (r.max_outlier_score != null) m.maxScore = Math.max(m.maxScore ?? 0, r.max_outlier_score);
    if (r.user_added) m.user = true;
    merged.set(r.channel_id, m);
  }
  const out: Candidate[] = [];
  for (const [channelId, m] of merged) {
    const s = states.get(channelId);
    if (s?.paused) continue;
    const source: ChannelSource = m.user ? (discovered.has(channelId) ? "discovered" : "user") : "library";
    const lastUploadAt = [s?.last_upload_at, m.latest].filter(Boolean).sort().at(-1) ?? null;
    const base = { source, lastUploadAt, maxScore: m.maxScore, errors: s?.consecutive_errors ?? 0 };
    const intervalHours = pollIntervalHours(base, now);
    const overdue = s?.last_polled_at
      ? (now - Date.parse(s.last_polled_at)) / (intervalHours * 3_600_000)
      : neverPolledRank(base, now);
    out.push({
      channelId,
      name: m.name,
      ...base,
      lastPolledAt: s?.last_polled_at ?? null,
      hasShorts: s?.has_shorts ?? null,
      shortsCheckedAt: s?.shorts_checked_at ?? null,
      intervalHours,
      overdue,
    });
  }
  return out.sort((a, b) => b.overdue - a.overdue);
}

/** The `limit` most overdue channels (only those due, overdue >= 1). */
export function selectDueChannels(db: DatabaseSync, limit: number, now = Date.now()): Candidate[] {
  return listCandidates(db, now)
    .filter((c) => c.overdue >= 1)
    .slice(0, limit);
}

/** Specific channels (CLI --channel, library sync), due or not. */
export function selectChannels(db: DatabaseSync, channelIds: string[], now = Date.now()): Candidate[] {
  const wanted = new Set(channelIds);
  const known = listCandidates(db, now).filter((c) => wanted.has(c.channelId));
  const found = new Set(known.map((c) => c.channelId));
  for (const id of channelIds) {
    if (found.has(id) || !CHANNEL_ID_RE.test(id)) continue;
    known.push({
      channelId: id,
      name: null,
      source: "user",
      lastUploadAt: null,
      maxScore: null,
      lastPolledAt: null,
      errors: 0,
      hasShorts: null,
      shortsCheckedAt: null,
      intervalHours: 1,
      overdue: 1000,
    });
  }
  return known;
}

/** Whether this poll should also fetch the channel's Shorts feed. */
export function shortsDue(c: Pick<Candidate, "hasShorts" | "shortsCheckedAt">, now = Date.now()): boolean {
  if (c.hasShorts == null || c.hasShorts === 1) return true;
  return !c.shortsCheckedAt || now - Date.parse(c.shortsCheckedAt) > 7 * DAY;
}
