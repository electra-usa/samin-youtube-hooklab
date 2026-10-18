// Contract every `hooklab` command implements. Commands live one per file in
// src/commands/<name>.ts and default-export a Command; main.ts loads them all.

export type OutputFormat = "table" | "json" | "jsonl" | "csv";

export type CliContext = {
  /** Requested output format (--json / --jsonl / --csv; default table). */
  format: OutputFormat;
  /** Print rows in the requested format; `columns` picks and orders table/CSV columns. */
  print: (rows: Record<string, unknown>[] | Record<string, unknown>, columns?: string[]) => void;
  /** Informational line on stderr (keeps stdout clean for piping). */
  info: (message: string) => void;
  /** Base URL of a running HookLab server, for commands that need one (HOOKLAB_URL). */
  serverUrl: string;
};

export type Command = {
  /** Subcommand name, e.g. "search" or "library". */
  name: string;
  /** One line for `hooklab help`. */
  summary: string;
  /** Usage text printed by `hooklab help <name>` (flags, examples). */
  usage: string;
  /** argv after the subcommand name. Return a process exit code (default 0). */
  run: (argv: string[], ctx: CliContext) => Promise<number | void>;
};
