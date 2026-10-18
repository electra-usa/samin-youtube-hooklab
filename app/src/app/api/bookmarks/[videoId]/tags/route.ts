import { NextResponse } from "next/server";
import { addTagsToBookmark, removeTagFromBookmark, setBookmarkTags } from "@/lib/research/bookmarks";
import { errorResponse, readBody } from "@/lib/research/http";

const names = (body: Record<string, unknown>) =>
  Array.isArray(body.tags) ? body.tags : typeof body.tag === "string" ? [body.tag] : typeof body.name === "string" ? [body.name] : [];

// POST { tag } | { tags: [] } -> add (tags are created on the fly) -> { tags }
export async function POST(req: Request, ctx: RouteContext<"/api/bookmarks/[videoId]/tags">) {
  const { videoId } = await ctx.params;
  const body = await readBody(req);
  try {
    return NextResponse.json({ tags: addTagsToBookmark(videoId, names(body)) });
  } catch (err) {
    return errorResponse(err, "Failed to add tag");
  }
}

// PUT { tags: [] } -> replace the bookmark's tags
export async function PUT(req: Request, ctx: RouteContext<"/api/bookmarks/[videoId]/tags">) {
  const { videoId } = await ctx.params;
  const body = await readBody(req);
  try {
    return NextResponse.json({ tags: setBookmarkTags(videoId, names(body)) });
  } catch (err) {
    return errorResponse(err, "Failed to update tags");
  }
}

// DELETE ?tag=<name or id> -> remove one tag from the bookmark
export async function DELETE(req: Request, ctx: RouteContext<"/api/bookmarks/[videoId]/tags">) {
  const { videoId } = await ctx.params;
  const body = await readBody(req);
  const tag = new URL(req.url).searchParams.get("tag") ?? names(body)[0];
  if (typeof tag !== "string" || !tag) return NextResponse.json({ error: "tag is required" }, { status: 400 });
  try {
    return NextResponse.json({ tags: removeTagFromBookmark(videoId, tag) });
  } catch (err) {
    return errorResponse(err, "Failed to remove tag");
  }
}
