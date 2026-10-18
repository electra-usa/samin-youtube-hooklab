import { NextResponse } from "next/server";
import { createProject, listProjects } from "@/lib/projects/store";
import { normalizeStatus } from "@/lib/projects/status";
import { errorResponse, readJson } from "@/app/api/user/_lib/http";

// GET /api/projects?q=&status=  -> { projects }   (original: getProjectPickerProjects / projects page)
export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const status = url.searchParams.get("status");
    const projects = listProjects({
      q: url.searchParams.get("q"),
      status: status && status !== "all" ? normalizeStatus(status) : null,
    });
    return NextResponse.json({ projects });
  } catch (err) {
    return errorResponse(err);
  }
}

// POST /api/projects { name, description?, status?, primaryChannelId? } -> { project }   (original: createProject)
export async function POST(req: Request) {
  try {
    const body = await readJson(req);
    const project = createProject(body);
    return NextResponse.json({ project }, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
