import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { aiModel, claudeCliPath } from "./config.ts";
import { AiError, type AiRequest, type AiResult } from "./types.ts";

// Runs the locally signed-in Claude Code CLI headlessly as a plain text generator:
// print mode, custom system prompt, no tools, no MCP, no plugins/hooks/CLAUDE.md
// (--safe-mode), no saved session, from an empty temp directory.
// Structured output uses --json-schema; the CLI streams it as the input of its
// StructuredOutput tool, which we forward as JSON deltas.

const TIMEOUT_MS = Number(process.env.HOOKLAB_CLI_TIMEOUT_MS) || 6 * 60_000;
const MAX_BUDGET_USD = process.env.HOOKLAB_CLI_MAX_BUDGET_USD?.trim() || "3";

// Variables that tie a child CLI to a parent Claude Code session.
const PARENT_SESSION_VARS = [
  "CLAUDECODE",
  "CLAUDE_CODE_ENTRYPOINT",
  "CLAUDE_CODE_SESSION_ID",
  "CLAUDE_CODE_CHILD_SESSION",
  "CLAUDE_CODE_SESSION_ATTENDED",
  "CLAUDE_CODE_MESSAGING_SOCKET",
  "CLAUDE_CODE_MESSAGING_TOKEN",
  "CLAUDE_CODE_EXECPATH",
  "CLAUDE_CODE_SSE_PORT",
  "CLAUDE_PID",
  "CLAUDE_EFFORT",
  "CLAUDE_AGENT_SDK_VERSION",
  "AI_AGENT",
];

function childEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const key of PARENT_SESSION_VARS) delete env[key];
  if (process.env.HOOKLAB_CLAUDE_CONFIG_DIR) env.CLAUDE_CONFIG_DIR = process.env.HOOKLAB_CLAUDE_CONFIG_DIR;
  return env;
}

/** The CLI takes a single prompt, so earlier turns are rendered as a transcript. */
function flatten(messages: AiRequest["messages"]): string {
  if (messages.length === 1) return messages[0].content;
  const history = messages
    .slice(0, -1)
    .map((m) => `<${m.role}>\n${m.content}\n</${m.role}>`)
    .join("\n\n");
  return `<conversation_so_far>\n${history}\n</conversation_so_far>\n\n${messages[messages.length - 1].content}`;
}

type CliEvent = {
  type: string;
  subtype?: string;
  event?: {
    type: string;
    index?: number;
    content_block?: { type: string; name?: string };
    delta?: { type: string; text?: string; partial_json?: string; stop_reason?: string };
    message?: { model?: string };
  };
  message?: { model?: string; stop_reason?: string | null; content?: { type: string; text?: string }[] };
  result?: string;
  structured_output?: unknown;
  is_error?: boolean;
  stop_reason?: string | null;
  api_error_status?: number | null;
  total_cost_usd?: number;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    cache_creation_input_tokens?: number;
    cache_read_input_tokens?: number;
  };
};

export async function runClaudeCode(req: AiRequest): Promise<AiResult> {
  const bin = claudeCliPath();
  if (!bin) throw new AiError("no_provider", "The Claude Code CLI wasn't found. Set HOOKLAB_CLAUDE_CLI to its path.");
  if (req.signal?.aborted) throw new AiError("aborted", "Stopped.");

  const model = req.model || aiModel();
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "hooklab-claude-"));
  const args = [
    "-p",
    "--output-format", "stream-json",
    "--verbose",
    "--include-partial-messages",
    "--model", model,
    "--effort", req.effort,
    "--system-prompt", req.system,
    "--tools", "",
    "--strict-mcp-config",
    "--safe-mode",
    "--disable-slash-commands",
    "--no-session-persistence",
    "--max-budget-usd", MAX_BUDGET_USD,
  ];
  if (req.schema) args.push("--json-schema", JSON.stringify(betaZodOutputFormat(req.schema).schema));

  return new Promise<AiResult>((resolve, reject) => {
    const child = spawn(bin, args, { cwd, env: childEnv(), stdio: ["pipe", "pipe", "pipe"] });
    let stdoutBuf = "";
    let stderr = "";
    let final: CliEvent | null = null;
    let servedModel = model;
    let jsonBlockIndex: number | null = null;
    let jsonBlocksSeen = 0;
    let lastStop: string | null = null;
    let settled = false;

    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      req.signal?.removeEventListener("abort", onAbort);
      fs.rm(cwd, { recursive: true, force: true }, () => {});
      fn();
    };
    const onAbort = () => {
      child.kill("SIGTERM");
      finish(() => reject(new AiError("aborted", "Stopped.")));
    };
    req.signal?.addEventListener("abort", onAbort, { once: true });
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      finish(() => reject(new AiError("timeout", "Claude took too long to answer. Please try again.")));
    }, TIMEOUT_MS);

    const handle = (ev: CliEvent) => {
      if (ev.type === "stream_event" && ev.event) {
        const e = ev.event;
        if (e.type === "message_start" && e.message?.model) servedModel = e.message.model;
        if (e.type === "content_block_start" && e.content_block?.type === "tool_use" && e.content_block.name === "StructuredOutput") {
          jsonBlockIndex = e.index ?? null;
          jsonBlocksSeen += 1;
          if (jsonBlocksSeen > 1) req.onJsonReset?.();
        }
        if (e.type === "content_block_delta" && e.delta) {
          if (e.delta.type === "input_json_delta" && e.index === jsonBlockIndex && e.delta.partial_json) {
            req.onJsonDelta?.(e.delta.partial_json);
          } else if (e.delta.type === "text_delta" && e.delta.text && !req.schema) {
            req.onTextDelta?.(e.delta.text);
          }
        }
        if (e.type === "message_delta" && e.delta?.stop_reason) lastStop = e.delta.stop_reason;
      } else if (ev.type === "assistant" && ev.message?.stop_reason) {
        lastStop = ev.message.stop_reason;
      } else if (ev.type === "result") {
        final = ev;
      }
    };

    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdoutBuf += chunk;
      let nl: number;
      while ((nl = stdoutBuf.indexOf("\n")) >= 0) {
        const line = stdoutBuf.slice(0, nl).trim();
        stdoutBuf = stdoutBuf.slice(nl + 1);
        if (!line) continue;
        try {
          handle(JSON.parse(line) as CliEvent);
        } catch {
          // Non-JSON noise on stdout is ignored.
        }
      }
    });
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      stderr = (stderr + chunk).slice(-4000);
    });
    child.on("error", (err) => finish(() => reject(new AiError("api", "Couldn't start the Claude Code CLI.", err.message))));
    child.on("close", (code) => {
      if (stdoutBuf.trim()) {
        try {
          handle(JSON.parse(stdoutBuf.trim()) as CliEvent);
        } catch {
          // ignore
        }
      }
      const result = final as CliEvent | null;
      if (!result) {
        finish(() =>
          reject(new AiError("api", "The Claude Code CLI stopped without an answer.", `exit ${code}: ${stderr.slice(-800)}`)),
        );
        return;
      }
      if (result.is_error) {
        finish(() => reject(cliError(result, stderr)));
        return;
      }
      const stopReason = result.stop_reason ?? lastStop;
      if (stopReason === "refusal") {
        finish(() =>
          reject(new AiError("refusal", "Claude declined this request. Try rephrasing it, or ask about a different angle of your video.")),
        );
        return;
      }
      let json: unknown;
      if (req.schema) {
        const raw = result.structured_output ?? safeJson(result.result);
        const parsed = req.schema.safeParse(raw);
        if (!parsed.success) {
          finish(() =>
            reject(new AiError("bad_output", "Claude's answer didn't come back in the expected format. Please try again.", parsed.error.message)),
          );
          return;
        }
        json = parsed.data;
      }
      const u = result.usage ?? {};
      finish(() =>
        resolve({
          provider: "claude-code",
          model: servedModel,
          text: req.schema ? JSON.stringify(json) : (result.result ?? ""),
          json,
          stopReason: stopReason ?? null,
          usage: {
            inputTokens: u.input_tokens ?? 0,
            outputTokens: u.output_tokens ?? 0,
            cacheCreationTokens: u.cache_creation_input_tokens ?? 0,
            cacheReadTokens: u.cache_read_input_tokens ?? 0,
            ...(typeof result.total_cost_usd === "number" ? { costUsd: result.total_cost_usd } : {}),
          },
        }),
      );
    });

    child.stdin.on("error", () => {});
    child.stdin.end(flatten(req.messages));
  });
}

function safeJson(text: string | undefined): unknown {
  if (!text) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function cliError(result: CliEvent, stderr: string): AiError {
  const text = `${result.result ?? ""} ${stderr}`.toLowerCase();
  const status = result.api_error_status ?? null;
  if (status === 401 || status === 403 || /log ?in|not logged|invalid api key|authenticat/.test(text)) {
    return new AiError("auth", "The Claude Code CLI isn't signed in. Run `claude` in a terminal and log in, then try again.", result.result);
  }
  if (status === 429 || /rate limit|usage limit/.test(text)) {
    return new AiError("rate_limit", "Your Claude plan's usage limit was reached. Try again later.", result.result);
  }
  if (status === 529 || /overloaded/.test(text)) {
    return new AiError("overloaded", "Claude is overloaded at the moment. Try again shortly.", result.result);
  }
  if (result.subtype === "error_max_budget_usd") {
    return new AiError("api", "This request hit HookLab's per-request spending cap (HOOKLAB_CLI_MAX_BUDGET_USD).", result.result);
  }
  return new AiError("api", "The Claude Code CLI returned an error. Please try again.", result.result ?? stderr.slice(-800));
}
