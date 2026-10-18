import { z } from "zod";
import { createWorkspace, listWorkspaces } from "../_lib/store";

// Studio workspaces (original server actions: getStudioWorkspace, saveStudioWorkspaceToProjects, …).
export async function GET() {
  return Response.json({ success: true, data: { workspaces: listWorkspaces() } });
}

const Create = z.object({
  name: z.string().trim().min(1).max(200),
  state: z.unknown(),
  projectId: z.string().nullish(),
});

export async function POST(req: Request) {
  const parsed = Create.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return Response.json({ success: false, error: "A workspace name and state are required" }, { status: 400 });
  const workspace = createWorkspace(parsed.data);
  return Response.json({ success: true, data: { workspace } }, { status: 201 });
}
