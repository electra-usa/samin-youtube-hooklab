import "server-only";
import { appDb, getSetting, nowIso, setSetting, tx } from "@/lib/db/app";
import { defaultOutlierFilters, normalizeOutlierFilters, type OutlierFilters } from "./filters";

// User-side state the research pages read on every request: hidden channels,
// saved default filters, and per-video bookmark / project membership.

export type HiddenChannel = { channelId: string; channelName: string };

const CHANNEL_ID_RE = /^[A-Za-z0-9_-]{1,128}$/;
const MAX_HIDDEN = 500;

export function listHiddenChannels(): HiddenChannel[] {
  const rows = appDb().prepare("SELECT channel_id, name FROM hidden_channels ORDER BY hidden_at ASC").all() as {
    channel_id: string;
    name: string | null;
  }[];
  return rows.map((r) => ({ channelId: r.channel_id, channelName: r.name || r.channel_id }));
}

export function hiddenChannelIds(): string[] {
  return listHiddenChannels().map((h) => h.channelId);
}

/** Accept the original's `hiddenChannels` objects or bare `hiddenChannelIds`. */
export function sanitizeHiddenChannels(input: { hiddenChannels?: unknown; hiddenChannelIds?: unknown }): HiddenChannel[] {
  const out = new Map<string, HiddenChannel>();
  if (Array.isArray(input.hiddenChannels)) {
    for (const item of input.hiddenChannels) {
      if (!item || typeof item !== "object") continue;
      const { channelId, channelName } = item as { channelId?: unknown; channelName?: unknown };
      const id = typeof channelId === "string" ? channelId.trim() : "";
      if (!CHANNEL_ID_RE.test(id)) continue;
      const name = typeof channelName === "string" ? channelName.trim().replace(/\s+/g, " ").slice(0, 120) : "";
      out.set(id, { channelId: id, channelName: name || id });
      if (out.size >= MAX_HIDDEN) break;
    }
  }
  if (Array.isArray(input.hiddenChannelIds)) {
    for (const raw of input.hiddenChannelIds) {
      const id = typeof raw === "string" ? raw.trim() : "";
      if (!CHANNEL_ID_RE.test(id) || out.has(id) || out.size >= MAX_HIDDEN) continue;
      out.set(id, { channelId: id, channelName: id });
    }
  }
  return [...out.values()];
}

export function replaceHiddenChannels(list: HiddenChannel[]): HiddenChannel[] {
  const existing = new Map(
    (appDb().prepare("SELECT channel_id, hidden_at FROM hidden_channels").all() as { channel_id: string; hidden_at: string }[]).map(
      (r) => [r.channel_id, r.hidden_at],
    ),
  );
  tx((db) => {
    db.exec("DELETE FROM hidden_channels");
    const insert = db.prepare("INSERT INTO hidden_channels (channel_id, name, hidden_at) VALUES (?, ?, ?)");
    for (const h of list) insert.run(h.channelId, h.channelName, existing.get(h.channelId) ?? nowIso());
  });
  return listHiddenChannels();
}

export type OutliersPreferences = {
  outliersDefaultFilters: OutlierFilters;
  hiddenChannelIds: string[];
  hiddenChannels: HiddenChannel[];
};

const DEFAULT_FILTERS_KEY = "outliers.defaultFilters";

export function getOutliersPreferences(): OutliersPreferences {
  const saved = getSetting<unknown>(DEFAULT_FILTERS_KEY, null);
  const hidden = listHiddenChannels();
  return {
    outliersDefaultFilters: normalizeOutlierFilters(saved ?? defaultOutlierFilters()),
    hiddenChannelIds: hidden.map((h) => h.channelId),
    hiddenChannels: hidden,
  };
}

export function updateOutliersPreferences(body: Record<string, unknown>): OutliersPreferences {
  if (body.outliersDefaultFilters !== undefined) {
    setSetting(DEFAULT_FILTERS_KEY, normalizeOutlierFilters(body.outliersDefaultFilters));
  }
  if (Array.isArray(body.hiddenChannels) || Array.isArray(body.hiddenChannelIds)) {
    replaceHiddenChannels(sanitizeHiddenChannels(body));
  }
  return getOutliersPreferences();
}

type Enrichable = { videoId: string; isBookmarked?: boolean; bookmarkTags?: string[]; projectIds?: string[] };

/** Fill isBookmarked / bookmarkTags / projectIds from the app DB (one pass per page of results). */
export function enrichVideos<T extends Enrichable>(videos: T[]): T[] {
  if (!videos.length) return videos;
  const ids = JSON.stringify([...new Set(videos.map((v) => v.videoId))]);
  const db = appDb();
  const bookmarkRows = db
    .prepare(
      `SELECT b.video_id AS videoId, t.name AS tag
       FROM bookmarks b
       LEFT JOIN bookmark_tags bt ON bt.bookmark_id = b.id
       LEFT JOIN tags t ON t.id = bt.tag_id
       WHERE b.video_id IN (SELECT value FROM json_each(?))
       ORDER BY t.name COLLATE NOCASE`,
    )
    .all(ids) as { videoId: string; tag: string | null }[];
  const tags = new Map<string, string[]>();
  for (const r of bookmarkRows) {
    const list = tags.get(r.videoId) ?? [];
    if (r.tag) list.push(r.tag);
    tags.set(r.videoId, list);
  }
  const projectRows = db
    .prepare(
      `SELECT DISTINCT ref_id AS videoId, project_id AS projectId FROM project_items
       WHERE kind IN ('video', 'bookmark') AND ref_id IN (SELECT value FROM json_each(?))`,
    )
    .all(ids) as { videoId: string; projectId: string }[];
  const projects = new Map<string, string[]>();
  for (const r of projectRows) projects.set(r.videoId, [...(projects.get(r.videoId) ?? []), r.projectId]);
  return videos.map((v) => ({
    ...v,
    isBookmarked: tags.has(v.videoId),
    bookmarkTags: tags.get(v.videoId) ?? [],
    projectIds: projects.get(v.videoId) ?? [],
  }));
}
