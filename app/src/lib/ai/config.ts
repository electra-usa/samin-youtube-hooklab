// Framework-free (no "server-only", relative .ts imports): the hooklab CLI and the refresh
// worker reuse these providers outside Next.js.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Which Claude provider HookLab uses and how to reach it. Everything is env-driven
// (app/.env.local) so nothing about a machine is baked into the code paths.
//   HOOKLAB_AI_PROVIDER = anthropic | claude-code | auto (default)
//   HOOKLAB_MODEL       = model id (default claude-opus-5-5)
//   HOOKLAB_CLAUDE_CLI  = path to the Claude Code binary (default: ~/.local/bin/claude, then PATH)

export type ProviderId = "anthropic" | "claude-code";
export type ProviderSetting = ProviderId | "auto";

export const DEFAULT_MODEL = "claude-opus-5-5";

export function aiModel(): string {
  return process.env.HOOKLAB_MODEL?.trim() || DEFAULT_MODEL;
}

export function providerSetting(): ProviderSetting {
  const v = (process.env.HOOKLAB_AI_PROVIDER ?? "auto").trim().toLowerCase();
  return v === "anthropic" || v === "claude-code" ? v : "auto";
}

function anthropicConfigDir(): string | null {
  if (process.env.ANTHROPIC_CONFIG_DIR) return process.env.ANTHROPIC_CONFIG_DIR;
  if (process.env.XDG_CONFIG_HOME) return path.join(process.env.XDG_CONFIG_HOME, "anthropic");
  const home = process.env.HOME || os.homedir();
  return home ? path.join(home, ".config", "anthropic") : null;
}

/**
 * Mirrors the SDK's credential chain closely enough to decide whether `new Anthropic()`
 * can authenticate: API key or auth token in env, workload identity federation env, or an
 * `ant auth login` profile on disk.
 */
export function hasAnthropicCredentials(): boolean {
  if (process.env.ANTHROPIC_API_KEY?.trim() || process.env.ANTHROPIC_AUTH_TOKEN?.trim()) return true;
  if (process.env.ANTHROPIC_FEDERATION_RULE_ID && process.env.ANTHROPIC_ORGANIZATION_ID) return true;
  const dir = anthropicConfigDir();
  if (!dir) return false;
  let profile = process.env.ANTHROPIC_PROFILE?.trim() || "";
  if (!profile) {
    try {
      profile = fs.readFileSync(path.join(dir, "active_config"), "utf8").trim();
    } catch {
      profile = "";
    }
  }
  profile ||= "default";
  return fs.existsSync(path.join(dir, "credentials", `${profile}.json`));
}

function isExecutable(file: string): boolean {
  try {
    fs.accessSync(file, fs.constants.X_OK);
    return fs.statSync(file).isFile();
  } catch {
    return false;
  }
}

export function claudeCliPath(): string | null {
  const explicit = process.env.HOOKLAB_CLAUDE_CLI?.trim();
  if (explicit) return isExecutable(explicit) ? explicit : null;
  const candidates = [path.join(os.homedir(), ".local", "bin", "claude")];
  for (const dir of (process.env.PATH ?? "").split(path.delimiter)) {
    if (dir) candidates.push(path.join(dir, "claude"));
  }
  return candidates.find(isExecutable) ?? null;
}

export type ProviderResolution =
  | { ok: true; provider: ProviderId; model: string; setting: ProviderSetting }
  | { ok: false; setting: ProviderSetting; error: string };

export const NO_PROVIDER_MESSAGE =
  "HookLab can't reach Claude yet. Add ANTHROPIC_API_KEY to app/.env.local (or run `ant auth login`), " +
  "or sign in to the Claude Code CLI with `claude` and set HOOKLAB_AI_PROVIDER=claude-code.";

export function resolveProvider(): ProviderResolution {
  const setting = providerSetting();
  const model = aiModel();
  if (setting === "anthropic") {
    return hasAnthropicCredentials()
      ? { ok: true, provider: "anthropic", model, setting }
      : { ok: false, setting, error: "HOOKLAB_AI_PROVIDER is set to anthropic, but no Anthropic credentials were found. " + NO_PROVIDER_MESSAGE };
  }
  if (setting === "claude-code") {
    return claudeCliPath()
      ? { ok: true, provider: "claude-code", model, setting }
      : { ok: false, setting, error: "HOOKLAB_AI_PROVIDER is set to claude-code, but the `claude` CLI wasn't found. Set HOOKLAB_CLAUDE_CLI to its path." };
  }
  if (hasAnthropicCredentials()) return { ok: true, provider: "anthropic", model, setting };
  if (claudeCliPath()) return { ok: true, provider: "claude-code", model, setting };
  return { ok: false, setting, error: NO_PROVIDER_MESSAGE };
}
