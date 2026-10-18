import "server-only";
import { appDb, listUserChannels, newId, nowIso } from "@/lib/db/app";
import { FollowingError, addChannelToList, createList, listFollowingLists, startSync, type ChannelInput } from "./following";
import { resolveChannel } from "./youtube";

const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);

function channelList(value: unknown): ChannelInput[] {
  if (!Array.isArray(value)) return [];
  return value.filter((c): c is ChannelInput => !!c && typeof c === "object" && typeof (c as ChannelInput).channelId === "string");
}

function listFor(name: string, type: "competitors" | "inspiration") {
  const existing = listFollowingLists().find((l) => l.name.toLowerCase() === name.toLowerCase());
  return existing ?? createList(name, type);
}

/** Original POST /api/channels/add: connect a channel and seed its competitor / inspiration lists. */
export async function addUserChannel(body: Record<string, unknown>) {
  const input = str(body.channelUrl) ?? str(body.url) ?? str(body.channelId);
  if (!input) throw new FollowingError("channelUrl is required");
  const resolved = await resolveChannel(input).catch(() => null);
  const channelId = resolved?.channelId ?? /(UC[\w-]{22})/.exec(input)?.[1] ?? null;
  if (!channelId) throw new FollowingError("Couldn't find that YouTube channel", 404);
  const name = resolved?.name ?? str(body.channelName) ?? channelId;

  const db = appDb();
  const existing = db.prepare("SELECT id FROM user_channels WHERE channel_id = ?").get(channelId) as { id: string } | undefined;
  const hasActive = !!db.prepare("SELECT 1 FROM user_channels WHERE is_active = 1").get();
  if (existing) {
    db.prepare(
      "UPDATE user_channels SET name = COALESCE(name, ?), handle = COALESCE(handle, ?), avatar = COALESCE(avatar, ?), subscriber_count = COALESCE(?, subscriber_count) WHERE id = ?",
    ).run(name, resolved?.handle ?? null, resolved?.avatar ?? null, resolved?.subscriberCount ?? null, existing.id);
  } else {
    db.prepare(
      `INSERT INTO user_channels (id, channel_id, name, handle, avatar, subscriber_count, is_active, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(newId(), channelId, name, resolved?.handle ?? null, resolved?.avatar ?? null, resolved?.subscriberCount ?? null, hasActive ? 0 : 1, nowIso());
  }

  const followed: string[] = [];
  const lists = [];
  for (const [label, type, channels] of [
    ["Competitors", "competitors", channelList(body.competitors)],
    ["Inspiration", "inspiration", channelList(body.inspirationChannels)],
  ] as const) {
    if (!channels.length) continue;
    const list = listFor(`${name} - ${label}`, type);
    for (const c of channels) followed.push(addChannelToList(list.id, c).channelId);
    lists.push({ id: list.id, name: list.name });
  }
  if (followed.length) startSync({ channelIds: followed });

  const channel = listUserChannels().find((c) => c.channelId === channelId)!;
  return { success: true, channel, lists };
}
