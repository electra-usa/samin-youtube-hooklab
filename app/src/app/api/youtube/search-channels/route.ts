import { NextResponse } from "next/server";
import { searchChannels } from "@/lib/research/channel-search";

// GET /api/youtube/search-channels?q=&maxResults= -> { channels: [...] }
// Library channels first, topped up from YouTube's public search page.
export async function GET(req: Request) {
  const params = new URL(req.url).searchParams;
  const q = params.get("q")?.trim() ?? "";
  const max = Math.min(25, Math.max(1, Number(params.get("maxResults")) || 6));
  if (q.length < 2) return NextResponse.json({ channels: [] });
  const channels = await searchChannels(q, max, { youtube: params.get("youtube") !== "0" });
  return NextResponse.json({ channels });
}
