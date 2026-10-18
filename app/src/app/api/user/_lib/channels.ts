import "server-only";
import { activeChannel, appDb, listUserChannels, newId, nowIso, tx, type UserChannel } from "@/lib/db/app";
import { channelLimit } from "@/lib/billing/ledger";
import { unlinkChannelFromProjects } from "@/lib/projects/store";
import {
  BANNED_PUNCTUATION_OPTIONS,
  DEFAULT_STYLE_GUIDE,
  normalizeTopics,
  parseBannedPunctuation,
  type ChannelProfileBody,
  type ChatPreferences,
  type DataSources,
  type StyleGuide,
} from "@/components/settings/shared";
import { AccountError } from "./account";

// Per-channel settings. These rows feed Chat's context, so they keep the original shapes:
// channel_profiles.profile_json = { profile:{overview,...}, generatedAt, primaryNiches, topics },
// style_guides.content = JSON StyleGuide, chat_preferences.prefs_json = ChatPreferences.

type Row = Record<string, unknown>;

function parse(text: unknown): unknown {
  if (typeof text !== "string" || !text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

export function requireChannel(userChannelId: unknown): UserChannel {
  if (typeof userChannelId !== "string" || !userChannelId) throw new AccountError("userChannelId is required");
  const channel = listUserChannels().find((c) => c.id === userChannelId);
  if (!channel) throw new AccountError("Channel not found", 404);
  return channel;
}

/** Same shape as the original GET /api/user/channels. */
export function channelsResponse() {
  return { channels: listUserChannels(), activeChannelId: activeChannel()?.id ?? null };
}

const str = (v: unknown, max = 500) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);
const int = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? Math.round(v) : null);

/** Adds a channel resolved by /api/youtube/resolve-channel (either its own or the original's field names). */
export function addUserChannel(input: Row): UserChannel {
  const channelId = str(input.channelId, 64);
  if (!channelId || !/^[\w-]+$/.test(channelId)) throw new AccountError("A YouTube channel id is required");
  const name = str(input.name, 200) ?? str(input.channelName, 200);
  if (!name) throw new AccountError("Channel name is required");
  const db = appDb();
  if (db.prepare("SELECT id FROM user_channels WHERE channel_id = ?").get(channelId)) {
    throw new AccountError(`${name} is already in your channels`, 409);
  }
  const limit = channelLimit();
  if (limit.atLimit) {
    throw new AccountError(`You've reached your channel limit (${limit.maxChannels} of ${limit.maxChannels}).`, 403);
  }
  const id = newId();
  const isFirst = listUserChannels().length === 0;
  db.prepare(
    `INSERT INTO user_channels (id, channel_id, name, handle, avatar, subscriber_count, video_count, is_active, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    channelId,
    name,
    str(input.handle, 100),
    str(input.avatar, 1000) ?? str(input.channelAvatar, 1000),
    int(input.subscriberCount),
    int(input.videoCount),
    isFirst ? 1 : 0,
    nowIso(),
  );
  return listUserChannels().find((c) => c.id === id)!;
}

/** Removes a channel and everything saved for it; another channel becomes active if needed. */
export function removeUserChannel(userChannelId: string) {
  const channel = requireChannel(userChannelId);
  tx((db) => {
    const videoIds = (db.prepare("SELECT video_id FROM channel_videos WHERE user_channel_id = ?").all(channel.id) as Row[]).map((r) =>
      String(r.video_id),
    );
    for (const table of ["channel_profiles", "style_guides", "chat_preferences", "channel_videos"]) {
      db.prepare(`DELETE FROM ${table} WHERE user_channel_id = ?`).run(channel.id);
    }
    const dropSnapshots = db.prepare("DELETE FROM video_view_snapshots WHERE video_id = ?");
    const dropTrophies = db.prepare("DELETE FROM trophies WHERE video_id = ?");
    for (const v of videoIds) {
      dropSnapshots.run(v);
      dropTrophies.run(v);
    }
    db.prepare("DELETE FROM user_channels WHERE id = ?").run(channel.id);
    if (channel.isActive) {
      const next = db.prepare("SELECT id FROM user_channels ORDER BY created_at ASC LIMIT 1").get() as Row | undefined;
      if (next) db.prepare("UPDATE user_channels SET is_active = CASE WHEN id = ? THEN 1 ELSE 0 END").run(String(next.id));
    }
  });
  unlinkChannelFromProjects(channel.id);
  return channelsResponse();
}

// ---- Channel profile -------------------------------------------------------------------

export function getChannelProfile(userChannelId: string): ChannelProfileBody | null {
  requireChannel(userChannelId);
  const row = appDb().prepare("SELECT profile_json FROM channel_profiles WHERE user_channel_id = ?").get(userChannelId) as Row | undefined;
  const body = parse(row?.profile_json) as Partial<ChannelProfileBody> | null | undefined;
  if (!body || typeof body !== "object") return null;
  const profile = body.profile && typeof body.profile === "object" ? body.profile : null;
  return {
    profile: profile ? { ...profile, overview: typeof profile.overview === "string" ? profile.overview : "" } : null,
    generatedAt: typeof body.generatedAt === "string" ? body.generatedAt : (profile?.generatedAt ?? null),
    primaryNiches: normalizeNiches(body.primaryNiches),
    topics: normalizeTopics(body.topics),
  };
}

function normalizeNiches(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((v): v is string => typeof v === "string" && v.trim().length > 0).map((v) => v.trim()))].slice(0, 12);
}

/** PATCH semantics of the original: overview/aboutMyChannel edit the profile text, niches/topics the context. */
export function saveChannelProfile(userChannelId: string, patch: Row): ChannelProfileBody {
  const channel = requireChannel(userChannelId);
  const current = getChannelProfile(userChannelId) ?? { profile: null, generatedAt: null, primaryNiches: [], topics: [] };
  const next: ChannelProfileBody = { ...current };
  if (patch.overview !== undefined || patch.aboutMyChannel !== undefined) {
    const profile = { ...(current.profile ?? { overview: "", channelId: channel.channelId }) };
    if (typeof patch.overview === "string" && patch.overview.trim()) profile.overview = patch.overview.trim().slice(0, 8000);
    if (patch.aboutMyChannel !== undefined) {
      if (patch.aboutMyChannel !== null && typeof patch.aboutMyChannel !== "string") throw new AccountError("aboutMyChannel must be text");
      profile.aboutMyChannel = (patch.aboutMyChannel ?? "").trim().slice(0, 8000);
    }
    next.profile = profile;
  }
  if (patch.primaryNiches !== undefined) next.primaryNiches = normalizeNiches(patch.primaryNiches);
  if (patch.topics !== undefined) next.topics = normalizeTopics(patch.topics);
  appDb()
    .prepare(
      `INSERT INTO channel_profiles (user_channel_id, profile_json, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(user_channel_id) DO UPDATE SET profile_json = excluded.profile_json, updated_at = excluded.updated_at`,
    )
    .run(userChannelId, JSON.stringify(next), nowIso());
  return next;
}

// ---- Style guide -------------------------------------------------------------------------

export function getStyleGuide(userChannelId: string): StyleGuide | null {
  requireChannel(userChannelId);
  const row = appDb().prepare("SELECT content FROM style_guides WHERE user_channel_id = ?").get(userChannelId) as Row | undefined;
  if (row?.content == null || row.content === "") return null;
  const parsed = parse(row.content);
  // Older rows may hold free text; treat it as writing rules.
  if (!parsed || typeof parsed !== "object") return { ...DEFAULT_STYLE_GUIDE, scriptWritingRules: String(row.content) };
  return normalizeStyleGuide(parsed as Row, DEFAULT_STYLE_GUIDE);
}

const clamp = (v: unknown, min: number, max: number, fallback: number) =>
  typeof v === "number" && Number.isFinite(v) ? Math.min(max, Math.max(min, Math.round(v))) : fallback;

function normalizeStyleGuide(input: Row, base: StyleGuide): StyleGuide {
  let minWords = clamp(input.minThumbnailWords, 0, 10, base.minThumbnailWords);
  let maxWords = clamp(input.maxThumbnailWords, 0, 10, base.maxThumbnailWords);
  if (minWords > maxWords) [minWords, maxWords] = [maxWords, minWords];
  const banned =
    input.bannedPunctuation === undefined ? parseBannedPunctuation(base.bannedPunctuation) : parseBannedPunctuation(input.bannedPunctuation);
  const phrases = Array.isArray(input.bannedWordsPhrases)
    ? [...new Set(input.bannedWordsPhrases.filter((v): v is string => typeof v === "string").map((v) => v.trim().slice(0, 100)).filter(Boolean))].slice(0, 100)
    : base.bannedWordsPhrases;
  return {
    maxTitleLength: clamp(input.maxTitleLength, 0, 100, base.maxTitleLength),
    minThumbnailWords: minWords,
    maxThumbnailWords: maxWords,
    // Keep only known options, in picker order, as a JSON string like the original.
    bannedPunctuation: banned.length ? JSON.stringify(BANNED_PUNCTUATION_OPTIONS.filter((o) => banned.includes(o))) : "",
    bannedWordsPhrases: phrases,
    scriptWritingRules:
      typeof input.scriptWritingRules === "string" ? input.scriptWritingRules.slice(0, 10000) : base.scriptWritingRules,
  };
}

export function saveStyleGuide(userChannelId: string, patch: Row): StyleGuide {
  const current = getStyleGuide(userChannelId) ?? DEFAULT_STYLE_GUIDE;
  const next = normalizeStyleGuide(patch, current);
  appDb()
    .prepare(
      `INSERT INTO style_guides (user_channel_id, content, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(user_channel_id) DO UPDATE SET content = excluded.content, updated_at = excluded.updated_at`,
    )
    .run(userChannelId, JSON.stringify(next), nowIso());
  return next;
}

// ---- Chat preferences ---------------------------------------------------------------------

export function getChatPreferences(userChannelId: string): ChatPreferences | null {
  requireChannel(userChannelId);
  const row = appDb().prepare("SELECT prefs_json FROM chat_preferences WHERE user_channel_id = ?").get(userChannelId) as Row | undefined;
  const raw = parse(row?.prefs_json) as Row | null | undefined;
  if (!raw || typeof raw !== "object") return null;
  return {
    ...raw,
    userChannelId,
    listIdsToUse: stringList(raw.listIdsToUse),
    bookmarkTagsToUse: stringList(raw.bookmarkTagsToUse),
    listInstructions: instructions(raw.listInstructions),
    additionalInstructions: typeof raw.additionalInstructions === "string" ? raw.additionalInstructions : null,
  };
}

function stringList(v: unknown): string[] | null {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : null;
}

function instructions(v: unknown): Record<string, string> {
  if (!v || typeof v !== "object" || Array.isArray(v)) return {};
  const out: Record<string, string> = {};
  for (const [k, text] of Object.entries(v as Row)) if (typeof text === "string" && text.trim()) out[k] = text.trim().slice(0, 1000);
  return out;
}

export function saveChatPreferences(userChannelId: string, patch: Row): ChatPreferences {
  const current = getChatPreferences(userChannelId);
  const now = nowIso();
  const next: ChatPreferences = {
    ...(current ?? { id: newId(), createdAt: now }),
    userChannelId,
    listIdsToUse: patch.listIdsToUse !== undefined ? stringList(patch.listIdsToUse) : (current?.listIdsToUse ?? null),
    bookmarkTagsToUse: patch.bookmarkTagsToUse !== undefined ? stringList(patch.bookmarkTagsToUse) : (current?.bookmarkTagsToUse ?? null),
    listInstructions: patch.listInstructions !== undefined ? instructions(patch.listInstructions) : (current?.listInstructions ?? {}),
    additionalInstructions:
      patch.additionalInstructions !== undefined
        ? typeof patch.additionalInstructions === "string" && patch.additionalInstructions.trim()
          ? patch.additionalInstructions.trim().slice(0, 4000)
          : null
        : (current?.additionalInstructions ?? null),
    updatedAt: now,
  };
  appDb()
    .prepare(
      `INSERT INTO chat_preferences (user_channel_id, prefs_json, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(user_channel_id) DO UPDATE SET prefs_json = excluded.prefs_json, updated_at = excluded.updated_at`,
    )
    .run(userChannelId, JSON.stringify(next), now);
  return next;
}

/** Following lists and bookmark tags the AI may draw on (owned by Research; read-only here). */
export function dataSources(): DataSources {
  const db = appDb();
  const lists = (
    db
      .prepare(
        `SELECT l.id, l.name, l.type, (SELECT count(*) FROM following_list_channels c WHERE c.list_id = l.id) AS channelCount
         FROM following_lists l ORDER BY l.created_at ASC, l.name ASC`,
      )
      .all() as Row[]
  ).map((r) => ({ id: String(r.id), name: String(r.name), type: r.type == null ? null : String(r.type), channelCount: Number(r.channelCount ?? 0) }));
  const bookmarkTags = (db.prepare("SELECT name FROM tags ORDER BY name COLLATE NOCASE").all() as Row[]).map((r) => String(r.name));
  return { lists, bookmarkTags };
}
