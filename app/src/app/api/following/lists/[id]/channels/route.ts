import { NextResponse } from "next/server";
import { addChannelToList, removeChannelFromList, startSync, type ChannelInput } from "@/lib/research/following";
import { errorResponse, readBody } from "@/lib/research/http";
import { resolveChannel } from "@/lib/research/youtube";

// Add a channel to a list (by channel object, or by URL / @handle like addChannelToListByUrl).
export async function POST(req: Request, ctx: RouteContext<"/api/following/lists/[id]/channels">) {
  const { id } = await ctx.params;
  const body = await readBody(req);
  try {
    let input = body as unknown as ChannelInput;
    const url = typeof body.url === "string" ? body.url : null;
    if (url && !body.channelId) {
      const resolved = await resolveChannel(url);
      if (!resolved) return NextResponse.json({ error: "Channel not found" }, { status: 404 });
      input = { channelId: resolved.channelId, channelName: resolved.name, handle: resolved.handle, channelAvatar: resolved.avatar, subscriberCount: resolved.subscriberCount };
    }
    const channel = addChannelToList(id, input);
    startSync({ channelIds: [channel.channelId], onlyStale: true });
    return NextResponse.json({ success: true, channel });
  } catch (err) {
    return errorResponse(err, "Failed to add channel");
  }
}

// Remove from this list only; the channel stays followed.
export async function DELETE(req: Request, ctx: RouteContext<"/api/following/lists/[id]/channels">) {
  const { id } = await ctx.params;
  const url = new URL(req.url);
  const body = await readBody(req);
  const channelId = url.searchParams.get("channelId") ?? (typeof body.channelId === "string" ? body.channelId : "");
  if (!channelId) return NextResponse.json({ error: "channelId is required" }, { status: 400 });
  removeChannelFromList(id, channelId);
  return NextResponse.json({ success: true });
}
