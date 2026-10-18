// `hooklab`: command-line access to the HookLab outlier library, its live refresh pipeline and
// the title generator. Every file in ./commands default-exports a Command and is loaded here,
// so adding a command is adding a file.
//
// Keep this module's static imports free of app/ code: Node warns about app/'s package.json
// (no "type" field) while loading those files, and the filter below must be installed first.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createPrinter, dim, bold } from "./format.ts";
import type { CliContext, Command, OutputFormat } from "./types.ts";

const CLI_DIR = fileURLToPath(new URL("..", import.meta.url));
const REPO_DIR = path.resolve(CLI_DIR, "..");
const COMMANDS_DIR = fileURLToPath(new URL("./commands/", import.meta.url));

// ------------------------------------------------------------------ process setup

// app/src/lib/core/*.ts are ESM under a package.json without "type" (Next owns it); Node reparses
// them and says so once. Nothing to act on, so keep stderr clean. Other warnings still print.
const QUIET_WARNINGS = new Set(["MODULE_TYPELESS_PACKAGE_JSON"]);
process.removeAllListeners("warning");
process.on("warning", (w: Error & { code?: string }) => {
  if (w.code && QUIET_WARNINGS.has(w.code)) return;
  if (w.name === "ExperimentalWarning" && /SQLite|Type Stripping/i.test(w.message)) return;
  process.stderr.write(`${w.name}: ${w.message}\n`);
});

// Piping into `head` closes stdout early; that's a normal way to stop.
process.stdout.on("error", (err: NodeJS.ErrnoException) => {
  if (err.code === "EPIPE") process.exit(0);
  throw err;
});

for (const file of [path.join(REPO_DIR, "app", ".env.local"), path.join(REPO_DIR, ".env")]) {
  // Earlier files win: loadEnvFile never overrides variables that are already set.
  if (fs.existsSync(file)) {
    try {
      process.loadEnvFile(file);
    } catch (err) {
      process.stderr.write(`hooklab: couldn't read ${file}: ${err instanceof Error ? err.message : err}\n`);
    }
  }
}

// ------------------------------------------------------------------ global flags

type Globals = { format: OutputFormat; help: boolean; version: boolean; rest: string[] };

function parseGlobals(argv: string[]): Globals {
  const g: Globals = { format: "table", help: false, version: false, rest: [] };
  let passthrough = false;
  for (const arg of argv) {
    if (passthrough) {
      g.rest.push(arg);
      continue;
    }
    if (arg === "--") {
      passthrough = true;
      g.rest.push(arg);
    } else if (arg === "--json") g.format = "json";
    else if (arg === "--jsonl" || arg === "--ndjson") g.format = "jsonl";
    else if (arg === "--csv") g.format = "csv";
    else if (arg === "--help" || arg === "-h") g.help = true;
    else if ((arg === "--version" || arg === "-v") && !g.rest.length) g.version = true;
    else g.rest.push(arg);
  }
  return g;
}

// ------------------------------------------------------------------ commands

type Loaded = { commands: Map<string, Command>; failures: { file: string; error: string }[] };

function isCommand(x: unknown): x is Command {
  const c = x as Command | null;
  return !!c && typeof c.name === "string" && typeof c.run === "function";
}

function commandFiles(): string[] {
  try {
    return fs
      .readdirSync(COMMANDS_DIR)
      .filter((f) => /\.(ts|mts|js|mjs)$/.test(f) && !/\.d\.ts$|\.test\.|\.spec\./.test(f) && !f.startsWith("_") && !f.startsWith("."))
      .sort();
  } catch {
    return [];
  }
}

async function importCommand(file: string): Promise<Command> {
  const mod = (await import(new URL(file, new URL("./commands/", import.meta.url)).href)) as { default?: unknown };
  if (!isCommand(mod.default)) throw new Error("doesn't default-export a Command");
  return mod.default;
}

async function loadAll(): Promise<Loaded> {
  const loaded: Loaded = { commands: new Map(), failures: [] };
  for (const file of commandFiles()) {
    try {
      const cmd = await importCommand(file);
      if (!loaded.commands.has(cmd.name)) loaded.commands.set(cmd.name, cmd);
    } catch (err) {
      loaded.failures.push({ file, error: err instanceof Error ? err.message.split("\n")[0] : String(err) });
    }
  }
  return loaded;
}

/** The named command: its own file first (fast; a broken sibling can't break it), else a full scan. */
async function findCommand(name: string): Promise<{ cmd: Command | null; loaded: Loaded | null }> {
  const file = commandFiles().find((f) => f.replace(/\.[^.]+$/, "") === name);
  if (file) {
    try {
      const cmd = await importCommand(file);
      if (cmd.name === name) return { cmd, loaded: null };
    } catch (err) {
      throw new Error(`The "${name}" command failed to load: ${err instanceof Error ? err.message : err}`);
    }
  }
  const loaded = await loadAll();
  return { cmd: loaded.commands.get(name) ?? null, loaded };
}

function version(): string {
  try {
    return (JSON.parse(fs.readFileSync(path.join(CLI_DIR, "package.json"), "utf8")) as { version?: string }).version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}

function overview(loaded: Loaded): string {
  const cmds = [...loaded.commands.values()].sort((a, b) => a.name.localeCompare(b.name));
  const width = Math.max(4, ...cmds.map((c) => c.name.length));
  const lines = [
    `${bold("hooklab")} ${dim(`v${version()}`)} — the HookLab outlier library from your terminal`,
    "",
    "Usage: hooklab <command> [arguments] [--json | --jsonl | --csv]",
    "",
    "Commands",
    ...cmds.map((c) => `  ${c.name.padEnd(width)}  ${c.summary}`),
    `  ${"help".padEnd(width)}  Show help for a command: hooklab help <command>`,
  ];
  if (loaded.failures.length) {
    lines.push("", "Not loaded", ...loaded.failures.map((f) => `  ${f.file}: ${f.error}`));
  }
  lines.push(
    "",
    "Output",
    "  (default)   a table sized to your terminal",
    "  --json      one JSON document",
    "  --jsonl     one JSON object per line",
    "  --csv       CSV with a header row (lists joined with |)",
    "",
    "Environment",
    "  HOOKLAB_URL         running HookLab server for `titles` (default http://localhost:3210)",
    "  HOOKLAB_API_KEY     sent as a bearer token when the server requires it",
    "  HOOKLAB_DATA_DIR    where library.db and app.db live (default: the repo's data/)",
    "  NO_COLOR            plain output",
    "",
    "Examples",
    '  hooklab search "ai agents" --min-outlier 5 --since 30d',
    "  hooklab top --niche Finance --limit 10",
    "  hooklab channel @IBMTechnology",
    '  hooklab export --format csv --out outliers.csv --tier bangers,mega_bangers',
    '  hooklab titles "I automated my YouTube channel with Claude"',
    "",
    "Docs: docs/CLI.md",
  );
  return `${lines.join("\n")}\n`;
}

function commandHelp(cmd: Command): string {
  return `${bold(`hooklab ${cmd.name}`)} — ${cmd.summary}\n\n${cmd.usage.trim()}\n\nGlobal flags: --json, --jsonl, --csv, --help\n`;
}

// ------------------------------------------------------------------ run

const isUsageError = (err: unknown) => {
  const e = err as { name?: string; code?: string } | null;
  return !!e && (e.name === "UsageError" || e.name === "QueryError" || (typeof e.code === "string" && e.code.startsWith("ERR_PARSE_ARGS")));
};

async function main(argv: string[]): Promise<number> {
  const g = parseGlobals(argv);
  if (g.version) {
    process.stdout.write(`${version()}\n`);
    return 0;
  }
  const [name, ...rest] = g.rest;

  if (!name || name === "help") {
    const target = name === "help" ? rest[0] : undefined;
    if (target) {
      const { cmd, loaded } = await findCommand(target);
      if (!cmd) {
        process.stderr.write(`Unknown command "${target}".\n\n${overview(loaded ?? (await loadAll()))}`);
        return 2;
      }
      process.stdout.write(commandHelp(cmd));
      return 0;
    }
    process.stdout.write(overview(await loadAll()));
    return 0;
  }

  const { cmd, loaded } = await findCommand(name);
  if (!cmd) {
    const all = loaded ?? (await loadAll());
    const close = [...all.commands.keys()].filter((c) => c.startsWith(name.slice(0, 2)));
    process.stderr.write(`Unknown command "${name}".${close.length ? ` Did you mean ${close.join(" or ")}?` : ""} Run \`hooklab help\`.\n`);
    return 2;
  }
  if (g.help) {
    process.stdout.write(commandHelp(cmd));
    return 0;
  }

  const ctx: CliContext = {
    format: g.format,
    print: createPrinter(g.format, process.stdout),
    info: (message) => process.stderr.write(`${message}\n`),
    serverUrl: (process.env.HOOKLAB_URL?.trim() || "http://localhost:3210").replace(/\/+$/, ""),
  };
  try {
    const code = await cmd.run(rest, ctx);
    return typeof code === "number" ? code : 0;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (isUsageError(err)) {
      process.stderr.write(`hooklab ${cmd.name}: ${message}\nRun \`hooklab help ${cmd.name}\` for usage.\n`);
      return 2;
    }
    process.stderr.write(`hooklab ${cmd.name}: ${message}\n`);
    if (process.env.HOOKLAB_DEBUG && err instanceof Error && err.stack) process.stderr.write(`${err.stack}\n`);
    return 1;
  }
}

process.exitCode = await main(process.argv.slice(2)).catch((err: unknown) => {
  process.stderr.write(`hooklab: ${err instanceof Error ? err.message : String(err)}\n`);
  if (process.env.HOOKLAB_DEBUG && err instanceof Error && err.stack) process.stderr.write(`${err.stack}\n`);
  return 1;
});
