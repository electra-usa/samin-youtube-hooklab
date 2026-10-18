import { NextResponse } from "next/server";
import { deleteProject, getProjectDetail, updateProject } from "@/lib/projects/store";
import { errorResponse, readJson } from "@/app/api/user/_lib/http";

// GET /api/projects/[id] -> ProjectDetail (project + chats, titles, videos, studio, notes)
export async function GET(_req: Request, ctx: RouteContext<"/api/projects/[id]">) {
  const { id } = await ctx.params;
  try {
    const detail = getProjectDetail(id);
    if (!detail) return NextResponse.json({ error: "Project not found" }, { status: 404 });
    return NextResponse.json(detail);
  } catch (err) {
    return errorResponse(err);
  }
}

// PATCH /api/projects/[id] { name?, description?, status?, primaryChannelId? } -> { project }
// (original: updateProject / updateProjectStatus)
export async function PATCH(req: Request, ctx: RouteContext<"/api/projects/[id]">) {
  const { id } = await ctx.params;
  try {
    const body = await readJson(req);
    const project = updateProject(id, {
      name: body.name,
      description: body.description,
      status: body.status,
      primaryChannelId: body.primaryChannelId,
    });
    return NextResponse.json({ project });
  } catch (err) {
    return errorResponse(err);
  }
}

// DELETE /api/projects/[id] -> { success }  (chats, pins and Studio workspaces are unassigned, not deleted)
export async function DELETE(_req: Request, ctx: RouteContext<"/api/projects/[id]">) {
  const { id } = await ctx.params;
  try {
    if (!deleteProject(id)) return NextResponse.json({ error: "Project not found" }, { status: 404 });
    return NextResponse.json({ success: true });
  } catch (err) {
    return errorResponse(err);
  }
}
