import { NextResponse } from "next/server";

// POST /api/user/change-password — the original's Password card. HookLab has no sign-in.
export async function POST() {
  return NextResponse.json(
    { error: "HookLab runs locally without sign-in, so there is no password to set or change." },
    { status: 501 },
  );
}
