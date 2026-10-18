import type { NextRequest } from "next/server";
import { z } from "zod";
import { deleteWorkspace, getWorkspace, updateWorkspace } from "../../_lib/store";

type Ctx = RouteContext<"/api/studio/workspaces/[id]">;

export async function GET(_req: NextRequest, ctx: Ctx) {
  const workspace = getWorkspace((await ctx.params).id);
  if (!workspace) return Response.json({ success: false, error: "Workspace not found" }, { status: 404 });
  return Response.json({ success: true, data: { workspace } });
}

const Patch = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  /** Full snapshot (autosave). */
  state: z.unknown().optional(),
  projectId: z.string().nullable().optional(),
});

// Rename, autosave state, or record the project it was filed under.
export async function PATCH(req: NextRequest, ctx: Ctx) {
  const parsed = Patch.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return Response.json({ success: false, error: "Invalid workspace update" }, { status: 400 });
  const workspace = updateWorkspace((await ctx.params).id, parsed.data);
  if (!workspace) return Response.json({ success: false, error: "Workspace not found" }, { status: 404 });
  return Response.json({ success: true, data: { workspace } });
}

export async function DELETE(_req: NextRequest, ctx: Ctx) {
  const ok = deleteWorkspace((await ctx.params).id);
  return Response.json({ success: ok }, { status: ok ? 200 : 404 });
}
