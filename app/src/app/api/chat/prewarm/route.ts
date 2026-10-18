import { NextResponse } from "next/server";
import { appDb } from "@/lib/db/app";
import { library } from "@/lib/db/library";
import { ensureChatTables } from "@/lib/chat/store";

// Fired when a chat page mounts (original: POST /api/chat/prewarm → {"ok":true}).
// Opens both databases so the first message doesn't wait on it.
export async function POST() {
  appDb();
  ensureChatTables();
  try {
    library();
  } catch {
    // The library may be mid-export; the stream reports it if it's still missing.
  }
  return NextResponse.json({ ok: true });
}
