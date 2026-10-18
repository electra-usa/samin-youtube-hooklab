import { NextResponse } from "next/server";
import { connection } from "next/server";
import { addBookmark, listBookmarks, listTags } from "@/lib/research/bookmarks";
import { errorResponse, readBody } from "@/lib/research/http";

// GET -> { bookmarks, tags }   (original getUserBookmarks + user tags)
export async function GET() {
  await connection();
  return NextResponse.json({ bookmarks: listBookmarks(), tags: listTags() });
}

// POST { video } (or { videoId }) -> { bookmark }
export async function POST(req: Request) {
  const body = await readBody(req);
  const video = (body.video && typeof body.video === "object" ? body.video : body) as Record<string, unknown>;
  try {
    return NextResponse.json({ bookmark: addBookmark(video) }, { status: 201 });
  } catch (err) {
    return errorResponse(err, "Failed to bookmark video");
  }
}
