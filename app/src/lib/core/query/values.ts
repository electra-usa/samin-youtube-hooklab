// Parsing for query parameters that arrive as strings (URL query, CLI flags) or as typed
// values (programmatic callers): numbers with k/M/B suffixes, comma lists, enums and dates.
import { QueryError } from "./errors.ts";

export type ParamValue = string | number | boolean | null | undefined | readonly (string | number)[];

const bad = (message: string) => new QueryError(message, { code: "invalid_parameter" });

/** Last non-empty scalar of a value (repeated scalar params: the last one wins). */
export function asString(value: ParamValue): string | undefined {
  if (value == null) return undefined;
  if (Array.isArray(value)) {
    for (let i = value.length - 1; i >= 0; i--) {
      const s = String(value[i]).trim();
      if (s) return s;
    }
    return undefined;
  }
  const s = String(value).trim();
  return s || undefined;
}

/** Repeatable and/or comma-separated values, trimmed, de-duplicated, in order. */
export function asList(value: ParamValue): string[] {
  if (value == null || value === "") return [];
  const items = Array.isArray(value) ? value : [value];
  const out: string[] = [];
  for (const item of items) {
    for (const part of String(item).split(",")) {
      const s = part.trim();
      if (s && !out.includes(s)) out.push(s);
    }
  }
  return out;
}

const SUFFIX: Record<string, number> = { k: 1e3, m: 1e6, b: 1e9 };

/** "25000", "25,000", "25k", "1.5M", "2b". Null when absent. */
export function parseAmount(name: string, value: ParamValue): number | null {
  if (typeof value === "number") {
    if (!Number.isFinite(value) || value < 0) throw bad(`${name} must be a non-negative number.`);
    return value;
  }
  const s = asString(value);
  if (s == null) return null;
  const m = /^(\d+(?:\.\d+)?)\s*([kmb])?$/i.exec(s.replace(/[,_\s]/g, ""));
  if (!m) throw bad(`${name} must be a number like 5, 2.5, 10k or 1.5M (got "${s}").`);
  const n = Number(m[1]) * (m[2] ? SUFFIX[m[2].toLowerCase()] : 1);
  if (!Number.isFinite(n)) throw bad(`${name} is out of range.`);
  return n;
}

export function parseInteger(name: string, value: ParamValue, opts: { min: number; max: number; fallback: number; clamp?: boolean }): number {
  const n = parseAmount(name, value);
  if (n == null) return opts.fallback;
  if (!Number.isInteger(n)) throw bad(`${name} must be a whole number.`);
  if (n < opts.min) throw bad(`${name} must be at least ${opts.min}.`);
  if (n > opts.max) {
    if (opts.clamp) return opts.max;
    throw bad(`${name} must be at most ${opts.max}.`);
  }
  return n;
}

export function parseEnum<T extends string>(name: string, value: ParamValue, allowed: readonly T[]): T | undefined {
  const s = asString(value)?.toLowerCase();
  if (s == null) return undefined;
  const hit = allowed.find((a) => a === s);
  if (!hit) throw bad(`${name} must be one of: ${allowed.join(", ")} (got "${s}").`);
  return hit;
}

export function parseBoolean(name: string, value: ParamValue): boolean | undefined {
  if (typeof value === "boolean") return value;
  const s = asString(value)?.toLowerCase();
  if (s == null) return undefined;
  if (["1", "true", "yes", "on"].includes(s)) return true;
  if (["0", "false", "no", "off"].includes(s)) return false;
  throw bad(`${name} must be true or false.`);
}

// ------------------------------------------------------------------ dates

const UNIT_MS: Record<string, number> = { h: 3_600_000, d: 86_400_000, w: 7 * 86_400_000 };

function unitOf(word: string): "h" | "d" | "w" | "m" | "y" | null {
  const w = word.toLowerCase();
  if (["h", "hr", "hrs", "hour", "hours"].includes(w)) return "h";
  if (["d", "day", "days"].includes(w)) return "d";
  if (["w", "wk", "wks", "week", "weeks"].includes(w)) return "w";
  if (["m", "mo", "mon", "month", "months"].includes(w)) return "m";
  if (["y", "yr", "yrs", "year", "years"].includes(w)) return "y";
  return null;
}

const startOfUtcDay = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));

/**
 * A publish-date bound as an ISO timestamp. Accepts relative ages (`7d`, `12h`, `2w`, `3m`, `1y`,
 * `30 days`), `today`/`yesterday`/`now`, `YYYY`, `YYYY-MM`, `YYYY-MM-DD` and full ISO timestamps.
 * `edge: "end"` (for `until`) turns a calendar period into its exclusive end, so
 * `until=2026-09-30` includes the whole day.
 */
export function parseDateBound(name: string, value: ParamValue, edge: "start" | "end", now: Date): string | null {
  const s = asString(value);
  if (s == null) return null;
  const lower = s.toLowerCase();

  const rel = /^(\d+(?:\.\d+)?)\s*([a-z]+)(?:\s+ago)?$/.exec(lower);
  if (rel) {
    const amount = Number(rel[1]);
    const unit = unitOf(rel[2]);
    if (!unit) throw bad(`${name}: unknown unit "${rel[2]}" (use h, d, w, m or y, e.g. 30d).`);
    if (unit === "m" || unit === "y") {
      if (!Number.isInteger(amount)) throw bad(`${name}: months and years must be whole numbers.`);
      const d = new Date(now);
      if (unit === "m") d.setUTCMonth(d.getUTCMonth() - amount);
      else d.setUTCFullYear(d.getUTCFullYear() - amount);
      return d.toISOString();
    }
    return new Date(now.getTime() - amount * UNIT_MS[unit]).toISOString();
  }

  const day = 86_400_000;
  if (lower === "now") return now.toISOString();
  if (lower === "today" || lower === "yesterday") {
    const start = startOfUtcDay(now).getTime() - (lower === "yesterday" ? day : 0);
    return new Date(edge === "end" ? start + day : start).toISOString();
  }

  let m = /^(\d{4})$/.exec(s);
  if (m) {
    const y = Number(m[1]);
    return new Date(Date.UTC(edge === "end" ? y + 1 : y, 0, 1)).toISOString();
  }
  m = /^(\d{4})-(\d{2})$/.exec(s);
  if (m) {
    const y = Number(m[1]);
    const mo = Number(m[2]) - 1;
    if (mo < 0 || mo > 11) throw bad(`${name}: invalid month in "${s}".`);
    return new Date(Date.UTC(y, edge === "end" ? mo + 1 : mo, 1)).toISOString();
  }
  m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (m) {
    const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
    if (Number.isNaN(d.getTime()) || d.getUTCDate() !== Number(m[3])) throw bad(`${name}: invalid date "${s}".`);
    return new Date(edge === "end" ? d.getTime() + day : d.getTime()).toISOString();
  }
  if (/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/.test(s)) {
    const t = Date.parse(s.replace(" ", "T"));
    if (!Number.isNaN(t)) return new Date(t).toISOString();
  }
  throw bad(`${name} must be a date (2026-09-30), a month (2026-09), a timestamp, or an age like 7d, 3m or 1y (got "${s}").`);
}
