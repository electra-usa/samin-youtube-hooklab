import { NextResponse } from "next/server";
import { getEmailPreferences, updateEmailPreferences } from "../_lib/account";
import { errorResponse, readJson } from "../_lib/http";

// GET /api/user/email-preferences -> { weeklyIdeasEmailOptIn, featuredChannelIds }   (stored locally; no email is sent)
export async function GET() {
  try {
    return NextResponse.json(getEmailPreferences());
  } catch (err) {
    return errorResponse(err);
  }
}

// PATCH /api/user/email-preferences { weeklyIdeasEmailOptIn?, featuredChannelIds? }
export async function PATCH(req: Request) {
  try {
    const body = await readJson(req);
    return NextResponse.json(updateEmailPreferences(body));
  } catch (err) {
    return errorResponse(err);
  }
}
