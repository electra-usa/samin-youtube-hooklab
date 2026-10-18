import { once } from "node:events";
import fs from "node:fs";
import path from "node:path";
import { FILTER_FLAGS, FILTER_HELP, UsageError, filtersFromFlags, parseFlags } from "../args.ts";
import { countVideos, exportVideos, type ExportFormat, type VideoSearchInput } from "../core.ts";
import { grouped } from "../format.ts";
import type { Command } from "../types.ts";

const command: Command = {
  name: "export",
  summary: "Stream every matching video to JSONL or CSV (file or stdout)",
  usage: `Usage: hooklab export --format jsonl|csv [--out FILE] [query…] [filters]

Streams all matching videos page by page (no row limit unless --limit is set), so it works on
the whole library while the refresh pipeline keeps writing. Progress goes to stderr.

  --format jsonl|csv    output format (or --jsonl / --csv, or inferred from --out's extension)
  --out FILE            write to FILE instead of stdout
  --limit N             stop after N rows
  --quiet               no progress output

CSV has a header row; lists (niches, clickTriggers, videoTypes) are joined with "|".
--fields picks and orders the columns. --cursor resumes a listing from a search page.

${FILTER_HELP.replace(/\n {2}--limit N[^\n]*/, "")}

Examples
  hooklab export --format csv --out library.csv
  hooklab export --format jsonl --since 30d --min-outlier 3 > recent-outliers.jsonl
  hooklab export --csv --tier bangers,mega_bangers --fields videoId,title,channelName,views,outlierScore --out bangers.csv
  hooklab export "ai agents" --format jsonl | jq -r '.title'`,
  async run(argv, ctx) {
    const { values, positionals } = parseFlags(argv, {
      ...FILTER_FLAGS,
      format: { type: "string" },
      out: { type: "string", short: "o" },
      quiet: { type: "boolean", short: "q" },
    });
    const ext = values.out ? path.extname(values.out).toLowerCase() : "";
    const requested = values.format?.toLowerCase() ?? (ctx.format === "csv" || ctx.format === "jsonl" ? ctx.format : null);
    const format: ExportFormat | null =
      requested === "csv" ? "csv" : requested === "jsonl" || requested === "ndjson" ? "jsonl" : !requested && ext === ".csv" ? "csv" : !requested && (ext === ".jsonl" || ext === ".ndjson") ? "jsonl" : null;
    if (!format) {
      throw new UsageError(
        requested ? `--format must be jsonl or csv (got "${requested}").` : "Pick an output format: --format jsonl or --format csv.",
      );
    }
    const input: VideoSearchInput = filtersFromFlags(values, positionals);
    const quiet = !!values.quiet;
    const tty = !!process.stderr.isTTY;

    const total = countVideos(input);
    const cap = input.limit != null ? Math.min(total, Number(String(input.limit).replace(/[,_]/g, "")) || total) : total;
    const target = values.out ? path.resolve(values.out) : null;
    if (!quiet) ctx.info(`Exporting ${grouped(cap)} videos as ${format.toUpperCase()}${target ? ` to ${target}` : ""}…`);
    if (!target && process.stdout.isTTY && !quiet) ctx.info("(Writing to the terminal. Use --out FILE or redirect to save it.)");

    let out: NodeJS.WritableStream = process.stdout;
    if (target) {
      const file = fs.createWriteStream(target);
      await once(file, "open");
      out = file;
    }
    const started = Date.now();
    let bytes = 0;
    let lastReport = 0;
    const progress = (n: number) => {
      if (quiet) return;
      const now = Date.now();
      if (tty) {
        if (now - lastReport < 150 && n < cap) return;
        lastReport = now;
        process.stderr.write(`\r  ${grouped(n)} / ${grouped(cap)} (${cap ? Math.floor((n / cap) * 100) : 100}%)   `);
      } else if (now - lastReport > 5000) {
        lastReport = now;
        process.stderr.write(`  ${grouped(n)} / ${grouped(cap)}\n`);
      }
    };

    let rows = 0;
    for await (const chunk of exportVideos(input, format, { onProgress: (n) => ((rows = n), progress(n)) })) {
      bytes += Buffer.byteLength(chunk);
      if (!out.write(chunk)) await once(out, "drain");
    }
    if (target) {
      out.end();
      await once(out, "finish");
    }
    if (!quiet) {
      if (tty) process.stderr.write("\r\x1b[K");
      const mb = bytes / 1024 / 1024;
      ctx.info(`Exported ${grouped(rows)} videos${target ? ` to ${target}` : ""} (${mb >= 1 ? `${mb.toFixed(1)} MB` : `${Math.ceil(bytes / 1024)} KB`}) in ${((Date.now() - started) / 1000).toFixed(1)}s.`);
    }
  },
};

export default command;
