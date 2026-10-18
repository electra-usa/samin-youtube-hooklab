import { NextResponse } from "next/server";

// GET /api/announcements/current -> { announcement: null }
// The original serves product-news slides here; HookLab has none (the account export also returned null).
export async function GET() {
  return NextResponse.json({ announcement: null });
}
