import { NextResponse } from "next/server";
import { getTeam, inviteTeamMember } from "@/lib/billing/team";
import { errorResponse, readJson } from "../_lib/http";

// GET /api/user/team -> { team: { name, people[] } | null, maxTeamMembers, seatsUsed, atLimit, upgradeMessage }
export async function GET() {
  try {
    return NextResponse.json(getTeam());
  } catch (err) {
    return errorResponse(err);
  }
}

// POST /api/user/team { email } -> { success, message, ...team }   (original: inviteTeamMember; recorded locally)
export async function POST(req: Request) {
  try {
    const body = await readJson(req);
    const message = inviteTeamMember(body.email);
    return NextResponse.json({ success: true, message, ...getTeam() }, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
