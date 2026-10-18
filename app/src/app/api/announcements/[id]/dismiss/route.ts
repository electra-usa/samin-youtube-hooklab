import { NextResponse } from "next/server";
import { getSetting, setSetting } from "@/lib/db/app";

// POST /api/announcements/[id]/dismiss -> { success }   (remembers the dismissal locally)
export async function POST(_req: Request, ctx: RouteContext<"/api/announcements/[id]/dismiss">) {
  const { id } = await ctx.params;
  const dismissed = getSetting<string[]>("announcements.dismissed", []);
  if (!dismissed.includes(id)) setSetting("announcements.dismissed", [...dismissed, id].slice(-100));
  return NextResponse.json({ success: true });
}
