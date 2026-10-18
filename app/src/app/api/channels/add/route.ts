import { NextResponse } from "next/server";
import { addUserChannel } from "@/lib/research/user-channel";
import { errorResponse, readBody } from "@/lib/research/http";

// POST /api/channels/add  { channelUrl, channelName, competitors?, inspirationChannels? }
// Adds a YouTube channel to the account and, as in the original onboarding, follows its
// competitor and inspiration channels in "<name> - Competitors" / "<name> - Inspiration" lists.
export async function POST(req: Request) {
  const body = await readBody(req);
  try {
    return NextResponse.json(await addUserChannel(body));
  } catch (err) {
    return errorResponse(err, "Failed to add channel");
  }
}
