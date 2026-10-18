import { NextResponse } from "next/server";
import { channelPayload } from "@/lib/research/channel-search";
import { resolveChannel } from "@/lib/research/youtube";

// GET /api/youtube/resolve-channel?url=<@handle | channel URL | channel id | video URL>
// -> { channel: { channelId, name, handle, avatar, subscriberCount, ... } }
export async function GET(req: Request) {
  const input = new URL(req.url).searchParams.get("url")?.trim() ?? "";
  if (!input) return NextResponse.json({ error: "Paste a YouTube channel URL, @handle or channel ID." }, { status: 400 });
  try {
    const channel = await resolveChannel(input);
    if (!channel) {
      return NextResponse.json({ error: "Channel not found. Make sure the URL is correct, or try searching by name." }, { status: 404 });
    }
    return NextResponse.json({ channel: channelPayload(channel) });
  } catch (err) {
    console.error("resolve-channel failed", err);
    return NextResponse.json({ error: "Couldn't reach YouTube to look up that channel. Try again." }, { status: 502 });
  }
}
