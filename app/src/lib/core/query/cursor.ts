// Opaque keyset cursors. A cursor carries the last row's sort key and id, a hash of the query
// it belongs to, and values frozen on the first page (resolved relative dates, relevance
// weights) so every page of one listing is computed the same way.
import { createHash } from "node:crypto";
import { QueryError } from "./errors.ts";

export type CursorKey = string | number | null;

export type Frozen = {
  /** Resolved `since` / `until` bounds (ISO). */
  since?: string | null;
  until?: string | null;
  /** Topic search: per-term IDF weights, phrase weight, average title length, match threshold. */
  weights?: number[];
  phraseWeight?: number | null;
  avgLen?: number;
  threshold?: number;
};

export type CursorState = {
  v: 1;
  /** Hash of the query (filters + sort) the cursor was issued for. */
  h: string;
  /** Last row: sort key values, then its id. */
  k: CursorKey[];
  id: string;
  f: Frozen;
};

export function queryHash(parts: unknown): string {
  return createHash("sha256").update(JSON.stringify(parts)).digest("base64url").slice(0, 16);
}

export function encodeCursor(state: CursorState): string {
  return Buffer.from(JSON.stringify(state), "utf8").toString("base64url");
}

const invalid = () =>
  new QueryError("Invalid cursor. Pass the nextCursor value from a previous response unchanged.", { code: "invalid_cursor" });

export function decodeCursor(cursor: string): CursorState {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
  } catch {
    throw invalid();
  }
  const c = parsed as Partial<CursorState> | null;
  const keyOk = (k: unknown) => k === null || typeof k === "string" || typeof k === "number";
  if (
    !c ||
    c.v !== 1 ||
    typeof c.h !== "string" ||
    typeof c.id !== "string" ||
    !Array.isArray(c.k) ||
    !c.k.every(keyOk) ||
    !c.f ||
    typeof c.f !== "object"
  ) {
    throw invalid();
  }
  return c as CursorState;
}

export function cursorMismatch(): QueryError {
  return new QueryError(
    "This cursor belongs to a different query. Repeat the original filters and sort with it, or drop the cursor to start over.",
    { code: "invalid_cursor" },
  );
}
