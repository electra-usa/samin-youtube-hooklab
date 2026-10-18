import "server-only";
import { NextResponse } from "next/server";

/** JSON body as a plain object (empty object when missing or malformed). */
export async function readBody(req: Request): Promise<Record<string, unknown>> {
  const body = await req.json().catch(() => null);
  return body && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>) : {};
}

/** Map domain errors (anything with a numeric `status`) to JSON responses. */
export function errorResponse(err: unknown, fallback = "Something went wrong") {
  if (err instanceof Error && typeof (err as Error & { status?: unknown }).status === "number") {
    return NextResponse.json({ error: err.message }, { status: (err as Error & { status: number }).status });
  }
  console.error(fallback, err);
  return NextResponse.json({ error: fallback }, { status: 500 });
}
