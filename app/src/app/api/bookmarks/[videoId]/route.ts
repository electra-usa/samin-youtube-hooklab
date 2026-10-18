import { NextResponse } from "next/server";
import { getBookmark, removeBookmark } from "@/lib/research/bookmarks";

export async function GET(_req: Request, ctx: RouteContext<"/api/bookmarks/[videoId]">) {
  const { videoId } = await ctx.params;
  const bookmark = getBookmark(videoId);
  return bookmark ? NextResponse.json({ bookmark }) : NextResponse.json({ error: "Bookmark not found" }, { status: 404 });
}

export async function DELETE(_req: Request, ctx: RouteContext<"/api/bookmarks/[videoId]">) {
  const { videoId } = await ctx.params;
  if (!removeBookmark(videoId)) return NextResponse.json({ error: "Bookmark not found" }, { status: 404 });
  return NextResponse.json({ success: true });
}
