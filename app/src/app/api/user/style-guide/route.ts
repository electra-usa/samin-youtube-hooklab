import { NextResponse } from "next/server";
import { getStyleGuide, saveStyleGuide } from "../_lib/channels";
import { errorResponse, readJson } from "../_lib/http";

// GET /api/user/style-guide?userChannelId= -> { styleGuide: StyleGuide | null, userChannelId }
export async function GET(req: Request) {
  try {
    const id = new URL(req.url).searchParams.get("userChannelId") ?? "";
    return NextResponse.json({ styleGuide: getStyleGuide(id), userChannelId: id });
  } catch (err) {
    return errorResponse(err);
  }
}

// PATCH /api/user/style-guide { userChannelId, maxTitleLength?, minThumbnailWords?, maxThumbnailWords?,
//   bannedPunctuation?, bannedWordsPhrases?, scriptWritingRules? } -> { styleGuide, userChannelId }
export async function PATCH(req: Request) {
  try {
    const body = await readJson(req);
    const id = String(body.userChannelId ?? "");
    return NextResponse.json({ styleGuide: saveStyleGuide(id, body), userChannelId: id });
  } catch (err) {
    return errorResponse(err);
  }
}
