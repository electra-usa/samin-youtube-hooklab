import { NextResponse } from "next/server";
import { deleteTag, renameTag } from "@/lib/research/bookmarks";
import { errorResponse, readBody } from "@/lib/research/http";

// `id` may be the tag id or its (URL-encoded) name, like the original's name-based renameTag/deleteTag.
export async function PATCH(req: Request, ctx: RouteContext<"/api/bookmarks/tags/[id]">) {
  const { id } = await ctx.params;
  const body = await readBody(req);
  try {
    return NextResponse.json({ tag: renameTag(decodeURIComponent(id), body.name) });
  } catch (err) {
    return errorResponse(err, "Failed to rename tag");
  }
}

export async function DELETE(_req: Request, ctx: RouteContext<"/api/bookmarks/tags/[id]">) {
  const { id } = await ctx.params;
  try {
    deleteTag(decodeURIComponent(id));
    return NextResponse.json({ success: true });
  } catch (err) {
    return errorResponse(err, "Failed to delete tag");
  }
}
