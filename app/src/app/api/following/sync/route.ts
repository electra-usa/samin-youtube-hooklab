import { NextResponse } from "next/server";
import { startSync, syncStatus } from "@/lib/research/following";
import { readBody } from "@/lib/research/http";

// Start RSS syncs: all followed channels, `channelIds`, only stale ones, or only failed ones (retry).
export async function POST(req: Request) {
  const body = await readBody(req);
  const channelIds = Array.isArray(body.channelIds)
    ? body.channelIds.filter((v): v is string => typeof v === "string")
    : typeof body.channelId === "string"
      ? [body.channelId]
      : undefined;
  const { queued } = startSync({ channelIds, onlyStale: body.onlyStale === true, onlyFailed: body.onlyFailed === true });
  return NextResponse.json({ ...syncStatus(), queued: queued > 0, queuedCount: queued });
}
