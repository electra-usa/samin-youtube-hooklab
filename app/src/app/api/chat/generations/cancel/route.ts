import { NextResponse } from "next/server";
import { cancelGeneration } from "@/lib/chat/generations";

// "Stop generating" (seen in the live chat bundle as POST /api/chat/generations/cancel).
// Body: { generationId } → the stream ends with done + cancelled and keeps what was streamed.
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { generationId?: unknown; reason?: unknown };
  const generationId = typeof body.generationId === "string" ? body.generationId : "";
  if (!generationId) return NextResponse.json({ error: "generationId is required" }, { status: 400 });
  const result = cancelGeneration(generationId, typeof body.reason === "string" ? body.reason.slice(0, 60) : "user_cancelled");
  if (result === "unknown") return NextResponse.json({ error: "Generation not found" }, { status: 404 });
  return NextResponse.json({ success: true, status: result });
}
