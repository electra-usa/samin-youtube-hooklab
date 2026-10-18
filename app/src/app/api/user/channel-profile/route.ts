import { NextResponse } from "next/server";
import { getChannelProfile, saveChannelProfile } from "../_lib/channels";
import { errorResponse, readJson } from "../_lib/http";

const EMPTY = { profile: null, generatedAt: null, primaryNiches: [], topics: [] };

// GET /api/user/channel-profile?userChannelId= -> { profile:{overview,...}|null, generatedAt, primaryNiches, topics }
export async function GET(req: Request) {
  try {
    const id = new URL(req.url).searchParams.get("userChannelId");
    return NextResponse.json(getChannelProfile(id ?? "") ?? EMPTY);
  } catch (err) {
    return errorResponse(err);
  }
}

// PATCH /api/user/channel-profile { userChannelId, overview?, aboutMyChannel?, primaryNiches?, topics? }
export async function PATCH(req: Request) {
  try {
    const body = await readJson(req);
    return NextResponse.json(saveChannelProfile(String(body.userChannelId ?? ""), body));
  } catch (err) {
    return errorResponse(err);
  }
}
