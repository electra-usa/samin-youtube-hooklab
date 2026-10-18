import { NextResponse } from "next/server";
import { AiError, generate } from "@/lib/ai";
import { appDb, listUserChannels, nowIso } from "@/lib/db/app";
import { NICHES } from "@/lib/taxonomy";
import { compactViews } from "@/lib/chat/format";
import { PROFILE_SYSTEM } from "@/lib/chat/prompts";
import { ProfileSchema, type ProfileOutput } from "@/lib/chat/schemas";
import { recordUsage } from "@/lib/ai/credits";

// Channel profile used as chat context. POST { userChannelId } regenerates it with Claude from the
// channel's synced videos (Settings → "Generate profile"); GET returns what is stored plus the
// style guide, for the chat header's channel popover.

type StoredProfile = {
  profile?: { overview?: string; aboutMyChannel?: string; channelId?: string; generatedAt?: string; basedOnVideoCount?: number };
  generatedAt?: string;
  primaryNiches?: string[];
  topics?: string[];
};

function readProfile(userChannelId: string): StoredProfile | null {
  const row = appDb().prepare("SELECT profile_json FROM channel_profiles WHERE user_channel_id = ?").get(userChannelId) as
    | { profile_json: string }
    | undefined;
  if (!row) return null;
  try {
    return JSON.parse(row.profile_json) as StoredProfile;
  } catch {
    return null;
  }
}

function pickChannel(id: string | null) {
  const channels = listUserChannels();
  return channels.find((c) => c.id === id || c.channelId === id) ?? channels.find((c) => c.isActive) ?? channels[0] ?? null;
}

export async function GET(req: Request) {
  const channel = pickChannel(new URL(req.url).searchParams.get("userChannelId"));
  if (!channel) return NextResponse.json({ error: "No channel connected" }, { status: 404 });
  const style = appDb().prepare("SELECT content FROM style_guides WHERE user_channel_id = ?").get(channel.id) as { content: string | null } | undefined;
  return NextResponse.json({ channel, profile: readProfile(channel.id), styleGuide: style?.content ?? null });
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { userChannelId?: unknown };
  const channel = pickChannel(typeof body.userChannelId === "string" ? body.userChannelId : null);
  if (!channel) return NextResponse.json({ error: "No channel connected" }, { status: 404 });

  const videos = appDb()
    .prepare("SELECT title, views, published_at, type FROM channel_videos WHERE user_channel_id = ? ORDER BY published_at DESC LIMIT 50")
    .all(channel.id) as { title: string; views: number; published_at: string | null; type: string }[];
  if (!videos.length) return NextResponse.json({ error: "Sync your channel's videos first (My Channel)." }, { status: 400 });

  const prompt = [
    `Channel: ${channel.name ?? "Unnamed"}${channel.subscriberCount ? ` (${compactViews(channel.subscriberCount)} subscribers)` : ""}`,
    `Recent videos (newest first):`,
    ...videos.map((v) => `- [${v.type}] "${v.title}" — ${compactViews(v.views)} views, ${v.published_at?.slice(0, 10) ?? "?"}`),
  ].join("\n");

  try {
    const result = await generate({
      system: PROFILE_SYSTEM,
      messages: [{ role: "user", content: prompt }],
      effort: "low",
      maxTokens: 4000,
      schema: ProfileSchema,
    });
    const out = result.json as ProfileOutput;
    const niches = out.primaryNiches.filter((n) => NICHES.includes(n)).slice(0, 3);
    const previous = readProfile(channel.id);
    const generatedAt = nowIso();
    const doc: StoredProfile = {
      ...previous,
      profile: {
        ...previous?.profile,
        overview: out.overview.trim(),
        channelId: channel.channelId,
        generatedAt,
        basedOnVideoCount: videos.length,
      },
      generatedAt,
      primaryNiches: niches.length ? niches : (previous?.primaryNiches ?? []),
      topics: previous?.topics ?? [],
    };
    appDb()
      .prepare(
        `INSERT INTO channel_profiles (user_channel_id, profile_json, updated_at) VALUES (?, ?, ?)
         ON CONFLICT(user_channel_id) DO UPDATE SET profile_json = excluded.profile_json, updated_at = excluded.updated_at`,
      )
      .run(channel.id, JSON.stringify(doc), generatedAt);
    recordUsage({ chatId: "channel-profile", messageId: channel.id, usage: result.usage, model: result.model });
    return NextResponse.json({ success: true, profile: doc.profile, primaryNiches: doc.primaryNiches, generatedAt });
  } catch (err) {
    const status = err instanceof AiError && err.code === "no_provider" ? 503 : 502;
    return NextResponse.json({ error: err instanceof Error ? err.message : "Failed to generate profile" }, { status });
  }
}
