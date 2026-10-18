import { NextResponse } from "next/server";
import { creditStatus } from "@/lib/ai/credits";

// Whether Chat may be used right now (original: GET /api/chat/usage-limit → { allowed }).
// HookLab never blocks a local user; the credit totals are informational.
export async function GET() {
  const status = creditStatus();
  return NextResponse.json({ allowed: true, ...status });
}
