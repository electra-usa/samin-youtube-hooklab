// Validation errors from the query core. `status` maps straight to an HTTP status in /api/v1
// and to a usage error (exit code 2) in the CLI.

export class QueryError extends Error {
  status: number;
  code: string;
  details: unknown;

  constructor(message: string, opts: { status?: number; code?: string; details?: unknown } = {}) {
    super(message);
    this.name = "QueryError";
    this.status = opts.status ?? 400;
    this.code = opts.code ?? "invalid_parameter";
    this.details = opts.details;
  }
}

export function isQueryError(err: unknown): err is QueryError {
  return err instanceof QueryError || (err instanceof Error && err.name === "QueryError" && typeof (err as QueryError).status === "number");
}
