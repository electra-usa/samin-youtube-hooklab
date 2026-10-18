import "server-only";
import { runAnthropic } from "./anthropic";
import { runClaudeCode } from "./claude-code";
import { claudeCliPath, hasAnthropicCredentials, resolveProvider } from "./config";
import { AiError, type AiRequest, type AiResult } from "./types";

export { AiError } from "./types";
export type { AiRequest, AiResult, AiTurn, AiUsage, Effort } from "./types";

/** Run one Claude request through whichever provider is configured. */
export async function generate(req: AiRequest): Promise<AiResult> {
  const resolved = resolveProvider();
  if (!resolved.ok) throw new AiError("no_provider", resolved.error);
  return resolved.provider === "anthropic" ? runAnthropic(req) : runClaudeCode(req);
}

export function providerStatus() {
  const resolved = resolveProvider();
  return {
    setting: resolved.setting,
    provider: resolved.ok ? resolved.provider : null,
    model: resolved.ok ? resolved.model : null,
    error: resolved.ok ? null : resolved.error,
    anthropicCredentials: hasAnthropicCredentials(),
    claudeCli: claudeCliPath(),
  };
}
