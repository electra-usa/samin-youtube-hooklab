import { NextResponse } from "next/server";
import { connection } from "next/server";
import {
  addChannelToList,
  channelManagementData,
  followChannel,
  followedChannelIds,
  startSync,
  unfollowChannel,
  type ChannelInput,
} from "@/lib/research/following";
import { errorResponse, readBody } from "@/lib/research/http";

// Followed channels with their list memberships (original getFollowingChannelManagementData).
export async function GET() {
  await connection();
  return NextResponse.json({ ...channelManagementData(), followedChannelIds: followedChannelIds() });
}

// Follow a channel, optionally straight into one or more lists; its feed syncs in the background.
export async function POST(req: Request) {
  const body = await readBody(req);
  try {
    const channel = followChannel(body as unknown as ChannelInput);
    const listIds = [
      ...(Array.isArray(body.listIds) ? body.listIds : []),
      ...(typeof body.listId === "string" ? [body.listId] : []),
    ].filter((v): v is string => typeof v === "string");
    for (const listId of listIds) addChannelToList(listId, { channelId: channel.channelId });
    startSync({ channelIds: [channel.channelId] });
    return NextResponse.json({ success: true, channel });
  } catch (err) {
    return errorResponse(err, "Failed to follow channel");
  }
}

// Unfollow: removes the channel from Following and from every list.
export async function DELETE(req: Request) {
  const url = new URL(req.url);
  const body = await readBody(req);
  const channelId = url.searchParams.get("channelId") ?? (typeof body.channelId === "string" ? body.channelId : "");
  if (!channelId) return NextResponse.json({ error: "channelId is required" }, { status: 400 });
  unfollowChannel(channelId);
  return NextResponse.json({ success: true });
}
