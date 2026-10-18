import "server-only";
import { NextResponse } from "next/server";

// Shared plumbing for the public /api/v1 surface: optional API-key auth, CORS, JSON errors.
// Auth is off unless HOOKLAB_API_KEY is set; then every v1 call needs the key as
// `Authorization: Bearer <key>` or `x-api-key: <key>`.

const corsHeaders = (): Record<string, string> => ({
  "Access-Control-Allow-Origin": process.env.HOOKLAB_CORS_ORIGIN ?? "*",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type, x-api-key",
});

export function v1Json(data: unknown, init?: { status?: number; headers?: Record<string, string> }) {
  return NextResponse.json(data, { status: init?.status ?? 200, headers: { ...corsHeaders(), ...init?.headers } });
}

export function v1Error(status: number, code: string, message: string) {
  return v1Json({ error: { code, message } }, { status });
}

/** Raw response (CSV/JSONL/SSE) with CORS headers. */
export function v1Raw(body: BodyInit, contentType: string, extra?: Record<string, string>) {
  return new Response(body, { headers: { ...corsHeaders(), "Content-Type": contentType, ...extra } });
}

export function v1Options() {
  return new Response(null, { status: 204, headers: corsHeaders() });
}

/** Returns an error response when the request lacks the configured API key, else null. */
export function v1Unauthorized(req: Request): Response | null {
  const key = process.env.HOOKLAB_API_KEY;
  if (!key) return null;
  const bearer = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  const provided = bearer || req.headers.get("x-api-key");
  return provided === key ? null : v1Error(401, "unauthorized", "Missing or invalid API key.");
}

/** Wrap a v1 handler with auth and uniform error handling. */
export function v1Handler<Ctx>(fn: (req: Request, ctx: Ctx) => Promise<Response> | Response) {
  return async (req: Request, ctx: Ctx): Promise<Response> => {
    const denied = v1Unauthorized(req);
    if (denied) return denied;
    try {
      return await fn(req, ctx);
    } catch (err) {
      const status = typeof (err as { status?: unknown })?.status === "number" ? (err as { status: number }).status : 500;
      const message = err instanceof Error ? err.message : "Unexpected error";
      return v1Error(status, status === 500 ? "internal_error" : "bad_request", message);
    }
  };
}

/** Error with an HTTP status, for validation failures inside handlers. */
export class V1Error extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}
