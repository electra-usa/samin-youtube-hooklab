import { NextResponse } from "next/server";
import { parseFollowingParams, queryFollowingVideos } from "@/lib/research/following";
import { errorResponse } from "@/lib/research/http";

// Feed of followed channels: library outliers plus RSS-synced uploads.
export async function GET(req: Request) {
  try {
    return NextResponse.json(queryFollowingVideos(parseFollowingParams(new URL(req.url).searchParams)));
  } catch (err) {
    return errorResponse(err, "Failed to load videos");
  }
}
