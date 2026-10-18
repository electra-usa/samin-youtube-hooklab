import "server-only";
import { library } from "@/lib/db/library";
import { addToFormulaIndex, createFormulaIndex, matchFormula, type FormulaIndex, type FormulaMatch } from "./title-formula";

// Process-wide formula index over every library title. The exporter only appends rows,
// so when it swaps in a bigger library the new rows are appended to the index instead
// of rebuilding it (a full build takes ~1 s per 150k titles).
type Cached = { maxRowid: number; index: FormulaIndex };
const store = globalThis as unknown as { __hooklabFormulaIndexV2?: Cached };

export function formulaIndex(): FormulaIndex {
  const db = library();
  const maxRowid = (db.prepare("SELECT max(rowid) AS n FROM videos").get() as { n: number | null }).n ?? 0;
  let cached = store.__hooklabFormulaIndexV2;
  if (!cached || maxRowid < cached.maxRowid) {
    const index = createFormulaIndex();
    addToFormulaIndex(index, db.prepare("SELECT id, title FROM videos WHERE rowid <= ?").iterate(maxRowid) as Iterable<{ id: string; title: string }>);
    cached = { maxRowid, index };
    store.__hooklabFormulaIndexV2 = cached;
  } else if (maxRowid > cached.maxRowid) {
    const fresh = db.prepare("SELECT id, title FROM videos WHERE rowid > ? AND rowid <= ?").iterate(cached.maxRowid, maxRowid);
    addToFormulaIndex(cached.index, fresh as Iterable<{ id: string; title: string }>);
    cached.maxRowid = maxRowid;
  }
  return cached.index;
}

export function formulaMatches(query: string, opts: { typed: boolean; limit?: number }): FormulaMatch[] {
  return matchFormula(formulaIndex(), query, { typed: opts.typed, limit: opts.limit ?? 3000 });
}
