// Streaming exporters: every matching video as JSONL or CSV, page by page over the keyset cursor,
// so a long export never holds a read lock (the refresh pipeline keeps writing) and survives a
// library rebuild swapping the file mid-way.
import { csvLine } from "./csv.ts";
import { libraryDb } from "./library.ts";
import { asString, parseInteger } from "./values.ts";
import { MAX_LIMIT, VIDEO_FIELDS, normalizeVideoQuery, runQuery, type VideoField, type VideoSearchInput } from "./videos.ts";

export type ExportFormat = "jsonl" | "csv";
export const EXPORT_FORMATS: ExportFormat[] = ["jsonl", "csv"];

export type ExportOptions = {
  /** Rows per page (default and max 1000). */
  pageSize?: number;
  /** Called after each page with the running row count. */
  onProgress?: (exported: number) => void;
  /** Stop early (client went away). */
  signal?: AbortSignal;
};

/** Columns an export writes: `fields` when given, else every field (+ relevance for topic searches). */
export function exportColumns(input: VideoSearchInput): VideoField[] {
  const q = normalizeVideoQuery({ ...input, cursor: undefined });
  if (q.fields) return q.fields;
  return q.q && q.mode === "topic" ? [...VIDEO_FIELDS, "relevance"] : [...VIDEO_FIELDS];
}

/**
 * Every video matching the filters, as text chunks (one page each). `limit` caps the total
 * number of rows (default: no cap); `cursor` resumes a previous listing.
 */
export async function* exportVideos(input: VideoSearchInput, format: ExportFormat, opts: ExportOptions = {}): AsyncGenerator<string> {
  const cap = asString(input.limit) == null ? Infinity : parseInteger("limit", input.limit, { min: 1, max: Number.MAX_SAFE_INTEGER, fallback: 0 });
  const pageSize = Math.min(Math.max(opts.pageSize ?? MAX_LIMIT, 1), MAX_LIMIT);
  const columns = exportColumns(input);
  let cursor = asString(input.cursor) ?? null;
  let exported = 0;
  if (format === "csv") yield csvLine(columns);
  for (;;) {
    if (opts.signal?.aborted) return;
    const take = Math.min(pageSize, cap - exported);
    if (take <= 0) return;
    const db = libraryDb();
    const q = normalizeVideoQuery({ ...input, limit: take, cursor: cursor ?? undefined, fields: columns, count: false }, db);
    const page = runQuery(db, q);
    if (page.data.length) {
      const rows = page.data as Record<string, unknown>[];
      yield format === "csv"
        ? rows.map((r) => csvLine(columns.map((c) => r[c]))).join("")
        : rows.map((r) => `${JSON.stringify(r)}\n`).join("");
      exported += rows.length;
      opts.onProgress?.(exported);
    }
    if (!page.nextCursor) return;
    cursor = page.nextCursor;
    // Let other work (HTTP requests, the refresh pipeline) run between pages.
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
}

/** A ReadableStream over exportVideos, for HTTP responses (pull-based, so it respects backpressure). */
export function exportStream(input: VideoSearchInput, format: ExportFormat, opts: ExportOptions = {}): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const controller = new AbortController();
  const gen = exportVideos(input, format, { ...opts, signal: controller.signal });
  return new ReadableStream<Uint8Array>({
    async pull(c) {
      try {
        const next = await gen.next();
        if (next.done) c.close();
        else c.enqueue(encoder.encode(next.value));
      } catch (err) {
        c.error(err);
      }
    },
    async cancel() {
      controller.abort();
      await gen.return(undefined);
    },
  });
}
