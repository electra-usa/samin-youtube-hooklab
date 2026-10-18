import { NextResponse } from "next/server";

// The original accepts PNG/JPG/WEBP screenshots as chat context. HookLab doesn't send images
// to Claude yet (the Claude Code provider is text-only), so this says so explicitly.
export async function POST() {
  return NextResponse.json(
    { error: "Screenshots aren't supported in HookLab yet. Describe the image in your message, or attach a transcript." },
    { status: 415 },
  );
}
