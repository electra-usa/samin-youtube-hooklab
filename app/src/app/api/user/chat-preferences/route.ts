import { NextResponse } from "next/server";
import { dataSources, getChatPreferences, saveChatPreferences } from "../_lib/channels";
import { errorResponse, readJson } from "../_lib/http";

// GET /api/user/chat-preferences?userChannelId= -> { chatPreferences | null, dataSources: { lists, bookmarkTags } }
export async function GET(req: Request) {
  try {
    const id = new URL(req.url).searchParams.get("userChannelId") ?? "";
    return NextResponse.json({ chatPreferences: getChatPreferences(id), dataSources: dataSources() });
  } catch (err) {
    return errorResponse(err);
  }
}

// PATCH /api/user/chat-preferences { userChannelId, additionalInstructions?, listIdsToUse?, bookmarkTagsToUse?, listInstructions? }
export async function PATCH(req: Request) {
  try {
    const body = await readJson(req);
    return NextResponse.json({ chatPreferences: saveChatPreferences(String(body.userChannelId ?? ""), body) });
  } catch (err) {
    return errorResponse(err);
  }
}
