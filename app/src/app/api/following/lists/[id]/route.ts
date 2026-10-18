import { NextResponse } from "next/server";
import { deleteList, renameList } from "@/lib/research/following";
import { errorResponse, readBody } from "@/lib/research/http";

export async function PATCH(req: Request, ctx: RouteContext<"/api/following/lists/[id]">) {
  const { id } = await ctx.params;
  const body = await readBody(req);
  try {
    return NextResponse.json({ list: renameList(id, body.name) });
  } catch (err) {
    return errorResponse(err, "Failed to rename list");
  }
}

export async function DELETE(_req: Request, ctx: RouteContext<"/api/following/lists/[id]">) {
  const { id } = await ctx.params;
  try {
    deleteList(id);
    return NextResponse.json({ success: true });
  } catch (err) {
    return errorResponse(err, "Failed to delete list");
  }
}
