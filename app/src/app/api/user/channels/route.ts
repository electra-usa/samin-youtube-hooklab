import { NextResponse } from "next/server";
import { addUserChannel, channelsResponse } from "../_lib/channels";
import { errorResponse, readJson } from "../_lib/http";

// GET /api/user/channels -> { channels, activeChannelId }
export async function GET() {
  try {
    return NextResponse.json(channelsResponse());
  } catch (err) {
    return errorResponse(err);
  }
}

// POST /api/user/channels { channelId, name, handle?, avatar?, subscriberCount? } -> { channel, channels, activeChannelId }
// The client resolves a URL/@handle first with /api/youtube/resolve-channel.
export async function POST(req: Request) {
  try {
    const channel = addUserChannel(await readJson(req));
    return NextResponse.json({ channel, ...channelsResponse() }, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
