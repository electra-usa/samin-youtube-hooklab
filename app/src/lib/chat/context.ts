import "server-only";
import { activeChannel, appDb, getSetting, listUserChannels, type UserChannel } from "@/lib/db/app";
import { compactViews } from "./format";
import { listAttachments, listMessages } from "./store";
import type { ChatAttachment, ChatMessageDTO, MessageCards } from "./types";

// "Loading context": everything HookLab knows about the creator that a reply may use.

export type ChannelVideo = {
  videoId: string;
  title: string;
  views: number;
  publishedAt: string | null;
  type: string;
  multiplier: number | null;
  durationSeconds: number | null;
};

export type FollowingList = { id: string; name: string; type: string | null; instruction: string | null; channels: { channelId: string; name: string | null }[] };

export type ChatContext = {
  channel: UserChannel | null;
  overview: string | null;
  aboutMyChannel: string | null;
  primaryNiches: string[];
  topics: string[];
  styleGuide: string | null;
  additionalInstructions: string | null;
  followingLists: FollowingList[];
  recentVideos: ChannelVideo[];
  topVideos: ChannelVideo[];
  shortsCount: number;
  avgRecentViews: number | null;
  attachments: ChatAttachment[];
  history: ChatMessageDTO[];
  excludedNiches: string[];
};

const parse = <T>(s: unknown): T | null => {
  if (typeof s !== "string" || !s) return null;
  try {
    return JSON.parse(s) as T;
  } catch {
    return null;
  }
};

function channelVideos(userChannelId: string, order: string, limit: number, type = "longform"): ChannelVideo[] {
  const rows = appDb()
    .prepare(
      `SELECT video_id, title, views, published_at, type, outlier_score, duration_seconds FROM channel_videos
       WHERE user_channel_id = ? AND type = ? ORDER BY ${order} LIMIT ?`,
    )
    .all(userChannelId, type, limit) as Record<string, unknown>[];
  return rows.map((r) => ({
    videoId: r.video_id as string,
    title: r.title as string,
    views: Number(r.views) || 0,
    publishedAt: (r.published_at as string) ?? null,
    type: r.type as string,
    multiplier: r.outlier_score == null ? null : Number(r.outlier_score),
    durationSeconds: r.duration_seconds == null ? null : Number(r.duration_seconds),
  }));
}

/** Renders a stored style guide (JSON fields from Settings, or free text). */
function renderStyleGuide(raw: string | null): string | null {
  if (!raw?.trim()) return null;
  const obj = parse<Record<string, unknown>>(raw);
  if (!obj || typeof obj !== "object") return raw.trim();
  const lines: string[] = [];
  const label: Record<string, string> = {
    maxTitleLength: "Max title length (characters)",
    minThumbnailWords: "Min thumbnail words",
    maxThumbnailWords: "Max thumbnail words",
    bannedPunctuation: "Banned punctuation",
    bannedWordsPhrases: "Banned words/phrases",
    scriptWritingRules: "Script writing rules",
  };
  for (const [k, v] of Object.entries(obj)) {
    if (v == null || v === "" || (Array.isArray(v) && !v.length)) continue;
    lines.push(`- ${label[k] ?? k}: ${Array.isArray(v) ? v.join(", ") : String(v)}`);
  }
  return lines.length ? lines.join("\n") : null;
}

export function loadContext(chatId: string | null, userChannelId: string | null): ChatContext {
  const db = appDb();
  const channels = listUserChannels();
  const channel = channels.find((c) => c.id === userChannelId) ?? activeChannel();
  const cid = channel?.id ?? "";

  const profileRow = db.prepare("SELECT profile_json FROM channel_profiles WHERE user_channel_id = ?").get(cid) as
    | { profile_json: string }
    | undefined;
  const profileDoc = parse<{
    profile?: { overview?: string; aboutMyChannel?: string };
    primaryNiches?: string[];
    topics?: string[];
  }>(profileRow?.profile_json);

  const style = db.prepare("SELECT content FROM style_guides WHERE user_channel_id = ?").get(cid) as { content: string | null } | undefined;
  const prefsRow = db.prepare("SELECT prefs_json FROM chat_preferences WHERE user_channel_id = ?").get(cid) as
    | { prefs_json: string }
    | undefined;
  const prefs = parse<{
    additionalInstructions?: string | null;
    listInstructions?: Record<string, string>;
    listIdsToUse?: string[] | null;
  }>(prefsRow?.prefs_json);

  const lists = db.prepare("SELECT id, name, type FROM following_lists ORDER BY created_at ASC").all() as {
    id: string;
    name: string;
    type: string | null;
  }[];
  const listChannels = db.prepare(
    `SELECT f.channel_id AS channelId, f.name AS name FROM following_list_channels l
     JOIN followed_channels f ON f.channel_id = l.channel_id WHERE l.list_id = ?`,
  );
  const followingLists: FollowingList[] = lists
    .filter((l) => !prefs?.listIdsToUse || prefs.listIdsToUse.includes(l.id))
    .map((l) => ({
      ...l,
      instruction: prefs?.listInstructions?.[l.id] ?? null,
      channels: listChannels.all(l.id) as { channelId: string; name: string | null }[],
    }));

  const recentVideos = cid ? channelVideos(cid, "published_at DESC", 20) : [];
  const topVideos = cid ? channelVideos(cid, "views DESC", 12) : [];
  const shortsCount = cid
    ? (db.prepare("SELECT count(*) AS n FROM channel_videos WHERE user_channel_id = ? AND type = 'shorts'").get(cid) as { n: number }).n
    : 0;
  const lastTen = recentVideos.slice(0, 10);
  const avgRecentViews = lastTen.length ? Math.round(lastTen.reduce((s, v) => s + v.views, 0) / lastTen.length) : null;

  const filters = getSetting<{ excludedNiches?: string[] }>("outliers.defaultFilters", {});

  return {
    channel,
    overview: profileDoc?.profile?.overview?.trim() || null,
    aboutMyChannel: profileDoc?.profile?.aboutMyChannel?.trim() || null,
    primaryNiches: profileDoc?.primaryNiches ?? [],
    topics: profileDoc?.topics ?? [],
    styleGuide: renderStyleGuide(style?.content ?? null),
    additionalInstructions: prefs?.additionalInstructions?.trim() || null,
    followingLists,
    recentVideos,
    topVideos,
    shortsCount,
    avgRecentViews,
    attachments: chatId ? listAttachments(chatId) : [],
    history: chatId ? listMessages(chatId) : [],
    excludedNiches: filters.excludedNiches ?? [],
  };
}

const date = (iso: string | null) => (iso ? iso.slice(0, 10) : "unknown date");

function videoLine(v: ChannelVideo): string {
  const mult = v.multiplier != null ? ` | ${v.multiplier.toFixed(1)}x your recent average` : "";
  return `- "${v.title}" | ${compactViews(v.views)} views | ${date(v.publishedAt)}${mult} | videoId=${v.videoId}`;
}

/** The creator's channel, preferences and attachments as a prompt section. */
export function renderChannelContext(ctx: ChatContext, opts: { videos?: "none" | "brief" | "full" } = {}): string {
  const out: string[] = [];
  const c = ctx.channel;
  out.push(`<creator_channel>`);
  out.push(c ? `Channel: ${c.name ?? "Unnamed"}${c.subscriberCount ? ` (${compactViews(c.subscriberCount)} subscribers)` : ""}` : "No channel connected.");
  if (ctx.primaryNiches.length) out.push(`Primary niches: ${ctx.primaryNiches.join(", ")}`);
  if (ctx.topics.length) out.push(`Topics: ${ctx.topics.join(", ")}`);
  if (ctx.overview) out.push(`Channel overview: ${ctx.overview}`);
  if (ctx.aboutMyChannel) out.push(`In the creator's words: ${ctx.aboutMyChannel}`);
  if (ctx.avgRecentViews != null) out.push(`Average views of the last 10 long-form videos: ${compactViews(ctx.avgRecentViews)}`);
  if (ctx.shortsCount) out.push(`The channel also has ${ctx.shortsCount} Shorts.`);
  const mode = opts.videos ?? "brief";
  if (mode !== "none" && ctx.recentVideos.length) {
    const recent = mode === "full" ? ctx.recentVideos : ctx.recentVideos.slice(0, 10);
    out.push(`\nMost recent long-form videos (newest first):\n${recent.map(videoLine).join("\n")}`);
    const top = mode === "full" ? ctx.topVideos : ctx.topVideos.slice(0, 8);
    out.push(`\nMost-viewed long-form videos:\n${top.map(videoLine).join("\n")}`);
  }
  out.push(`</creator_channel>`);

  if (ctx.styleGuide || ctx.additionalInstructions) {
    out.push(`\n<creator_preferences>`);
    if (ctx.styleGuide) out.push(`Style guide (follow strictly):\n${ctx.styleGuide}`);
    if (ctx.additionalInstructions) out.push(`Additional instructions: ${ctx.additionalInstructions}`);
    out.push(`</creator_preferences>`);
  }

  const lists = ctx.followingLists.filter((l) => l.channels.length || l.instruction);
  if (lists.length) {
    out.push(`\n<followed_channels>`);
    for (const l of lists) {
      const names = l.channels.map((ch) => ch.name ?? ch.channelId).join(", ") || "(no channels yet)";
      out.push(`- List "${l.name}"${l.instruction ? ` — ${l.instruction}` : ""}: ${names}`);
    }
    out.push(`</followed_channels>`);
  }

  if (ctx.attachments.length) {
    out.push(`\n<attachments>`);
    for (const a of ctx.attachments) {
      const label = a.label ?? (a.type === "transcript" ? "Transcript" : "Document");
      out.push(`<attachment type="${a.type}" label="${label.replace(/"/g, "'")}"${a.sourceUrl ? ` source="${a.sourceUrl}"` : ""}>`);
      out.push(a.transcriptText ?? "");
      out.push(`</attachment>`);
    }
    out.push(`</attachments>`);
  }
  return out.join("\n");
}

/** Text form of an assistant reply for conversation history. */
export function renderAssistantForHistory(m: ChatMessageDTO): string {
  const cards: MessageCards | null = m.cards;
  if (!cards) return m.content;
  const parts: string[] = [];
  if (cards.summary) parts.push(cards.summary);
  for (const card of cards.angleCards ?? []) {
    const more = (cards.expansions?.[card.id] ?? []).flatMap((b) => b.titles);
    parts.push(
      [`Angle: ${card.emoji} ${card.name}${card.isRecommended ? " (recommended)" : ""}`, card.description, ...card.titles.map((t) => `- ${t.title}`), ...more.map((t) => `- ${t.title}`)]
        .filter(Boolean)
        .join("\n"),
    );
  }
  if (cards.thumbnailTexts?.length) parts.push(`Thumbnail text options:\n${cards.thumbnailTexts.map((t) => `- ${t.text}`).join("\n")}`);
  if (cards.bodyMarkdown) parts.push(cards.bodyMarkdown);
  if (!cards.angleCards?.length && !cards.thumbnailTexts?.length && m.content && m.content !== cards.summary) parts.push(m.content);
  return parts.join("\n\n") || m.content;
}

/** Last turns as alternating user/assistant text, newest last (excluding the message being answered). */
export function historyTurns(history: ChatMessageDTO[], maxTurns = 12): { role: "user" | "assistant"; content: string }[] {
  const turns = history
    .filter((m) => m.content.trim() || m.cards)
    .slice(-maxTurns)
    .map((m) => ({ role: m.role, content: m.role === "assistant" ? renderAssistantForHistory(m) : m.content }));
  // The API needs the first turn to be a user turn and roles to alternate; merge where needed.
  const merged: { role: "user" | "assistant"; content: string }[] = [];
  for (const t of turns) {
    const last = merged[merged.length - 1];
    if (last && last.role === t.role) last.content += `\n\n${t.content}`;
    else merged.push({ ...t });
  }
  while (merged.length && merged[0].role !== "user") merged.shift();
  return merged;
}

export function summarizeForRouting(history: ChatMessageDTO[]): string {
  return history
    .slice(-6)
    .map((m) => {
      const text = m.role === "assistant" ? renderAssistantForHistory(m) : m.content;
      const pill = m.promptPill ? ` [clicked suggestion: ${m.promptPill.label}]` : "";
      return `${m.role === "user" ? "Creator" : "HookLab"}${pill}: ${text.slice(0, 700)}`;
    })
    .join("\n");
}
