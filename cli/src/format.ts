// Output helpers for every `hooklab` command: tables sized to the terminal, JSON, JSONL, CSV,
// and small number/date formatters. Nothing here imports the app (main.ts loads it first).
import { styleText } from "node:util";
import type { CliContext, OutputFormat } from "./types.ts";

type Row = Record<string, unknown>;

// ------------------------------------------------------------------ color

const colorEnabled = (stream: NodeJS.WriteStream) =>
  !!stream.isTTY && !process.env.NO_COLOR && process.env.TERM !== "dumb" && !process.env.HOOKLAB_NO_COLOR;

type Style = Parameters<typeof styleText>[0];

/** Styled text for stdout (plain when stdout isn't a color terminal). */
export function paint(style: Style, text: string, stream: NodeJS.WriteStream = process.stdout): string {
  return colorEnabled(stream) ? styleText(style, text, { validateStream: false }) : text;
}

export const dim = (s: string, stream?: NodeJS.WriteStream) => paint("dim", s, stream);
export const bold = (s: string, stream?: NodeJS.WriteStream) => paint("bold", s, stream);

// ------------------------------------------------------------------ text width

const ANSI = /\x1b\[[0-9;]*m/g;
const segmenter = new Intl.Segmenter("en", { granularity: "grapheme" });
const WIDE =
  /[ᄀ-ᅟ⺀-〾ぁ-㏿㐀-䶿一-鿿ꀀ-꓏가-힣豈-﫿︰-﹏＀-｠￠-￦]/u;
const EMOJI = /\p{Extended_Pictographic}|\p{Regional_Indicator}/u;
const ZERO = /^[\p{Mn}\p{Me}\p{Cf}​-‏︀-️]+$/u;

export function stripAnsi(s: string): string {
  return s.replace(ANSI, "");
}

function graphemeWidth(g: string): number {
  if (ZERO.test(g)) return 0;
  if (EMOJI.test(g) || WIDE.test(g)) return 2;
  return 1;
}

/** Terminal columns a string occupies (ANSI-aware; emoji and CJK count as 2). */
export function textWidth(s: string): number {
  let w = 0;
  for (const { segment } of segmenter.segment(stripAnsi(s))) w += graphemeWidth(segment);
  return w;
}

/** Cut to `width` columns with an ellipsis (drops styling when it has to cut). */
export function truncate(s: string, width: number): string {
  if (textWidth(s) <= width) return s;
  if (width <= 0) return "";
  const plain = stripAnsi(s);
  let out = "";
  let w = 0;
  for (const { segment } of segmenter.segment(plain)) {
    const gw = graphemeWidth(segment);
    if (w + gw > width - 1) break;
    out += segment;
    w += gw;
  }
  return `${out}…`;
}

/** Word-wrap plain text to `width` columns, prefixing every line with `indent`. */
export function wrap(text: string, width: number, indent = ""): string {
  const room = Math.max(20, width - textWidth(indent));
  const lines: string[] = [];
  for (const para of text.split(/\n/)) {
    let line = "";
    for (const word of para.split(/\s+/).filter(Boolean)) {
      if (line && textWidth(line) + 1 + textWidth(word) > room) {
        lines.push(line);
        line = word;
      } else line = line ? `${line} ${word}` : word;
    }
    lines.push(line);
  }
  return lines.map((l) => indent + l).join("\n");
}

const pad = (s: string, width: number, right: boolean) => {
  const gap = Math.max(0, width - textWidth(s));
  return right ? " ".repeat(gap) + s : s + " ".repeat(gap);
};

export function terminalWidth(stream: NodeJS.WriteStream = process.stdout): number {
  if (stream.isTTY && stream.columns) return stream.columns;
  const env = Number(process.env.COLUMNS);
  return Number.isFinite(env) && env > 20 ? env : 200;
}

// ------------------------------------------------------------------ values

/** "1.2M", "83.4K", "950". */
export function compact(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "";
  const abs = Math.abs(n);
  const f = (v: number, s: string) => `${Number(v.toFixed(v < 10 ? 1 : 0))}${s}`;
  if (abs >= 1e9) return f(n / 1e9, "B");
  if (abs >= 1e6) return f(n / 1e6, "M");
  if (abs >= 1e3) return f(n / 1e3, "K");
  return String(Math.round(n));
}

/** "12.3x". */
export function score(x: number | null | undefined): string {
  if (x == null || !Number.isFinite(x)) return "";
  return `${x >= 100 ? Math.round(x) : x.toFixed(1)}x`;
}

export function grouped(n: number | null | undefined): string {
  return n == null || !Number.isFinite(n) ? "" : n.toLocaleString("en-US");
}

/** "2026-10-18". */
export function day(iso: string | null | undefined): string {
  return iso ? iso.slice(0, 10) : "";
}

/** "2026-10-18 21:08 UTC". */
export function stamp(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : `${d.toISOString().slice(0, 16).replace("T", " ")} UTC`;
}

/** "3 days ago". */
export function ago(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return "";
  const s = (now - new Date(iso).getTime()) / 1000;
  if (!Number.isFinite(s)) return "";
  if (s < 90) return "just now";
  const units: [number, string][] = [
    [60, "minute"],
    [3600, "hour"],
    [86400, "day"],
    [86400 * 30.44, "month"],
    [86400 * 365.25, "year"],
  ];
  let [size, name] = units[0];
  for (const u of units) if (s >= u[0]) [size, name] = u;
  const n = Math.floor(s / size);
  return `${n} ${name}${n === 1 ? "" : "s"} ago`;
}

/** "18:35", "1:41:44". */
export function clock(seconds: number | null | undefined): string {
  if (seconds == null || !Number.isFinite(seconds)) return "";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}` : `${m}:${String(s).padStart(2, "0")}`;
}

export function percent(part: number, total: number): string {
  return total ? `${((part / total) * 100).toFixed(part / total < 0.1 ? 1 : 0)}%` : "";
}

export function bar(part: number, max: number, width = 20): string {
  if (!max || part <= 0) return "";
  const cells = (part / max) * width;
  const full = Math.floor(cells);
  const partial = ["", "▏", "▎", "▍", "▌", "▋", "▊", "▉"][Math.round((cells - full) * 7)] ?? "";
  return "█".repeat(full) + partial || "▏";
}

/** Plain text for one table cell. */
export function cellText(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "boolean") return v ? "yes" : "no";
  if (typeof v === "number") return Number.isInteger(v) ? String(v) : String(Number(v.toFixed(2)));
  if (Array.isArray(v)) return v.map(cellText).join(", ");
  if (typeof v === "object") return JSON.stringify(v);
  return String(v).replace(/\s*[\r\n]+\s*/g, " ");
}

// ------------------------------------------------------------------ CSV

export function csvCell(value: unknown): string {
  let s: string;
  if (value == null) s = "";
  else if (Array.isArray(value)) s = value.map((v) => (v == null ? "" : typeof v === "object" ? JSON.stringify(v) : String(v))).join("|");
  else if (typeof value === "object") s = JSON.stringify(value);
  else s = String(value);
  return /[",\r\n]|^\s|\s$/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function csvLine(values: unknown[]): string {
  return `${values.map(csvCell).join(",")}\n`;
}

// ------------------------------------------------------------------ tables

export type TableOptions = {
  /** Columns to right-align (default: columns whose values all look numeric). */
  right?: string[];
  /** Header labels (default: the column key, upper-cased). */
  labels?: Record<string, string>;
  /** Column that absorbs most of the shrinking (default: the widest). */
  flex?: string;
  width?: number;
  stream?: NodeJS.WriteStream;
};

const NUMERIC = /^[-+]?[\d.,]+[%xKMB]?$|^$/;

export function renderTable(rows: Row[], columns: string[], opts: TableOptions = {}): string {
  const stream = opts.stream ?? process.stdout;
  const cells = rows.map((r) => columns.map((c) => cellText(r[c])));
  const labels = columns.map((c) => opts.labels?.[c] ?? c.replace(/([a-z])([A-Z])/g, "$1 $2").toUpperCase());
  const right = columns.map((c, i) => opts.right?.includes(c) ?? (rows.length > 0 && cells.every((row) => NUMERIC.test(stripAnsi(row[i])))));
  const widths = columns.map((_, i) => Math.min(80, Math.max(textWidth(labels[i]), ...cells.map((row) => textWidth(row[i])))));
  const budget = opts.width ?? terminalWidth(stream);
  const gap = 2;
  const used = () => widths.reduce((a, b) => a + b, 0) + gap * (columns.length - 1);
  const flex = opts.flex ? columns.indexOf(opts.flex) : -1;
  // Shrink the flex column first (down to 20), then whichever column is widest.
  while (used() > budget) {
    let i = flex >= 0 && widths[flex] > 20 ? flex : widths.indexOf(Math.max(...widths));
    if (widths[i] <= 6) {
      i = widths.findIndex((w) => w > 6);
      if (i < 0) break;
    }
    widths[i]--;
  }
  const line = (values: string[], header = false) =>
    values
      .map((v, i) => {
        const text = pad(truncate(v, widths[i]), widths[i], right[i]);
        return header ? dim(text, stream) : text;
      })
      .join(" ".repeat(gap))
      .trimEnd();
  return [line(labels, true), ...cells.map((row) => line(row))].join("\n") + "\n";
}

/** Two-column "Label   value" block for one record; long values wrap under themselves. */
export function renderRecord(entries: [string, string][], stream: NodeJS.WriteStream = process.stdout): string {
  const width = Math.max(...entries.map(([k]) => textWidth(k)), 0);
  const budget = terminalWidth(stream) - width - 2;
  const indent = " ".repeat(width + 2);
  return (
    entries
      .filter(([, v]) => v !== "")
      .map(([k, v]) => {
        const value = budget > 20 && textWidth(v) > budget && !/\x1b\[/.test(v) ? wrap(v, budget + width + 2, indent).slice(indent.length) : v;
        return `${dim(pad(k, width, false), stream)}  ${value}`;
      })
      .join("\n") + "\n"
  );
}

function flatten(obj: Row, prefix = ""): [string, string][] {
  const out: [string, string][] = [];
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === "object" && !Array.isArray(v) && prefix.split(".").length < 2) out.push(...flatten(v as Row, key));
    else out.push([key, cellText(v)]);
  }
  return out;
}

function columnsOf(rows: Row[]): string[] {
  const cols: string[] = [];
  for (const r of rows) for (const k of Object.keys(r)) if (!cols.includes(k)) cols.push(k);
  return cols;
}

/** ctx.print: rows (or one record) in the requested format. */
export function createPrinter(format: OutputFormat, stream: NodeJS.WriteStream = process.stdout): CliContext["print"] {
  return (data, columns) => {
    const list = Array.isArray(data) ? data : null;
    if (format === "json") {
      stream.write(`${JSON.stringify(data, null, 2)}\n`);
    } else if (format === "jsonl") {
      for (const r of list ?? [data]) stream.write(`${JSON.stringify(r)}\n`);
    } else if (format === "csv") {
      const rows = list ?? [data as Row];
      const cols = columns ?? columnsOf(rows);
      stream.write(csvLine(cols) + rows.map((r) => csvLine(cols.map((c) => r[c]))).join(""));
    } else if (list) {
      if (!list.length) {
        process.stderr.write("No results.\n");
        return;
      }
      stream.write(renderTable(list, columns ?? columnsOf(list), { stream }));
    } else {
      const record = data as Row;
      const entries = columns ? columns.map((c): [string, string] => [c, cellText(record[c])]) : flatten(record);
      stream.write(renderRecord(entries, stream));
    }
  };
}
