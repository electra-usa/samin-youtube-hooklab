import "server-only";
import { v1Handler, v1Json } from "@/lib/api-v1/http";
import { QueryError, VIDEO_QUERY_PARAMS, isQueryError, type VideoSearchInput } from "@/lib/core/query";

// Glue between the query core and the /api/v1 route handlers.

/** v1Handler (auth, CORS, 500s) plus the query core's validation errors as 4xx with details. */
export function v1Route<Ctx = unknown>(fn: (req: Request, ctx: Ctx) => Promise<Response> | Response) {
  return v1Handler<Ctx>(async (req, ctx) => {
    try {
      return await fn(req, ctx);
    } catch (err) {
      if (isQueryError(err)) {
        return v1Json(
          { error: { code: err.code, message: err.message, ...(err.details ? { details: err.details } : {}) } },
          { status: err.status },
        );
      }
      throw err;
    }
  });
}

/** Query parameters as core input; repeated keys become lists. Unknown keys are a 400 (keys starting with "_" are ignored). */
export function paramsInput(sp: URLSearchParams, allowed: readonly string[]): Record<string, string | string[]> {
  const out: Record<string, string | string[]> = {};
  for (const key of new Set(sp.keys())) {
    if (key.startsWith("_")) continue;
    if (!allowed.includes(key)) {
      throw new QueryError(`Unknown query parameter "${key}". Allowed: ${allowed.join(", ")}.`, { code: "unknown_parameter" });
    }
    const values = sp.getAll(key);
    out[key] = values.length > 1 ? values : values[0];
  }
  return out;
}

export type OutputFormat = "json" | "jsonl" | "csv";
const OUTPUT_FORMATS: Record<string, OutputFormat> = { json: "json", jsonl: "jsonl", ndjson: "jsonl", csv: "csv" };

/**
 * Video filters from a query string. `format` does double duty: json/jsonl/csv pick the response
 * format, any other value is a title-format filter (also available unambiguously as `titleFormat`).
 */
export function videoParams(sp: URLSearchParams, opts: { defaultOutput?: OutputFormat } = {}): { input: VideoSearchInput; output: OutputFormat } {
  const raw = paramsInput(sp, [...VIDEO_QUERY_PARAMS, "titleFormat"]);
  let output = opts.defaultOutput ?? "json";
  const titleFormats: string[] = [];
  for (const value of [raw.format ?? []].flat().flatMap((v) => v.split(","))) {
    const v = value.trim();
    if (!v) continue;
    const out = OUTPUT_FORMATS[v.toLowerCase()];
    if (out) output = out;
    else titleFormats.push(v);
  }
  titleFormats.push(...[raw.titleFormat ?? []].flat());
  const input: VideoSearchInput = { ...raw };
  delete (input as Record<string, unknown>).titleFormat;
  input.format = titleFormats.length ? titleFormats : undefined;
  return { input, output };
}

export const CONTENT_TYPES: Record<OutputFormat, string> = {
  json: "application/json; charset=utf-8",
  jsonl: "application/x-ndjson; charset=utf-8",
  csv: "text/csv; charset=utf-8",
};

/** Lets browsers read the paging headers on CSV/JSONL responses. */
export const EXPOSE_HEADERS = { "Access-Control-Expose-Headers": "X-Next-Cursor, X-Has-More, X-Total-Count, Content-Disposition" };

export const origin = (req: Request) => new URL(req.url).origin;
