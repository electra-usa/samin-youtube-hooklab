// RFC 4180 CSV cells: quoted when they contain a comma, quote, newline or edge spaces; quotes doubled.
// Arrays are joined with "|", objects become JSON, null/undefined become empty cells.

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

export function csvRows(rows: Record<string, unknown>[], columns: string[]): string {
  return csvLine(columns) + rows.map((r) => csvLine(columns.map((c) => r[c]))).join("");
}
