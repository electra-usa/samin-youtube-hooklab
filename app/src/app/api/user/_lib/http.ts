import "server-only";
import { NextResponse } from "next/server";

// Shared by Worker D's route handlers (user, billing, projects, getting-started).

/** Errors from the settings/billing/project modules carry an HTTP `status`; anything else is a 500. */
export function errorResponse(err: unknown) {
  const status = typeof (err as { status?: unknown })?.status === "number" ? (err as { status: number }).status : 500;
  const message = err instanceof Error && status < 500 ? err.message : "Something went wrong";
  if (status >= 500) console.error(err);
  return NextResponse.json({ error: message }, { status });
}

export async function readJson(req: Request): Promise<Record<string, unknown>> {
  const body = await req.json().catch(() => null);
  return body && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>) : {};
}
