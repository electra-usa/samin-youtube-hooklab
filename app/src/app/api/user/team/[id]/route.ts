import { NextResponse } from "next/server";
import { getTeam, markInvitationJoined, removeTeamPerson, resendInvitation } from "@/lib/billing/team";
import { errorResponse, readJson } from "../../_lib/http";

// POST /api/user/team/[id] { action: "resend" | "accept" } -> { success, message, ...team }
export async function POST(req: Request, ctx: RouteContext<"/api/user/team/[id]">) {
  const { id } = await ctx.params;
  try {
    const { action } = await readJson(req);
    if (action !== "resend" && action !== "accept") {
      return NextResponse.json({ error: 'action must be "resend" or "accept"' }, { status: 400 });
    }
    const message = action === "resend" ? resendInvitation(id) : markInvitationJoined(id);
    return NextResponse.json({ success: true, message, ...getTeam() });
  } catch (err) {
    return errorResponse(err);
  }
}

// DELETE /api/user/team/[id] -> removes a member or a pending invitation
export async function DELETE(_req: Request, ctx: RouteContext<"/api/user/team/[id]">) {
  const { id } = await ctx.params;
  try {
    const message = removeTeamPerson(id);
    return NextResponse.json({ success: true, message, ...getTeam() });
  } catch (err) {
    return errorResponse(err);
  }
}
