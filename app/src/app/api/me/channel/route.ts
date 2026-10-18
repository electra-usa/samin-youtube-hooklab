import { NextResponse } from "next/server";
import { appDb, listUserChannels } from "@/lib/db/app";

// Switch the active channel (the original's switchChannel server action).
export async function POST(req: Request) {
  const { userChannelId } = (await req.json().catch(() => ({}))) as { userChannelId?: string };
  if (!userChannelId || !listUserChannels().some((c) => c.id === userChannelId)) {
    return NextResponse.json({ error: "Unknown channel" }, { status: 400 });
  }
  const db = appDb();
  db.prepare("UPDATE user_channels SET is_active = CASE WHEN id = ? THEN 1 ELSE 0 END").run(userChannelId);
  return NextResponse.json({ success: true, activeChannelId: userChannelId });
}
