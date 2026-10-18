import "server-only";
import { appDb, getSetting, newId, nowIso } from "@/lib/db/app";
import type { AiUsage } from "./types";

// Credits are HookLab's unit of AI work (the original: "Credits measure the AI work used in
// Chat"). 1 credit = $0.02 of model usage at list prices, rounded up, minimum 1 per request:
//   usd = (input * in + cacheWrite * in * 1.25 + cacheRead * in * 0.1 + output * out) / 1e6
//   credits = max(1, ceil(usd / 0.02))
// When the Claude Code CLI reports its own list-price cost (total_cost_usd), that figure is
// used instead because it also covers the CLI's small side calls.
export const USD_PER_CREDIT = 0.02;

const PRICES: Record<string, { input: number; output: number }> = {
  "claude-opus-5-5": { input: 4, output: 20 },
  "claude-opus-5": { input: 5, output: 25 },
  "claude-fable-5-1": { input: 10, output: 50 },
  "claude-fable-5": { input: 10, output: 50 },
  "claude-sonnet-5-5": { input: 2, output: 10 },
  "claude-sonnet-5": { input: 2, output: 10 },
  "claude-haiku-5-5": { input: 0.1, output: 0.5 },
};

export function usageCostUsd(usage: AiUsage, model: string): number {
  if (usage.costUsd != null && Number.isFinite(usage.costUsd)) return usage.costUsd;
  const p = PRICES[model] ?? PRICES["claude-opus-5-5"];
  return (
    (usage.inputTokens * p.input +
      usage.cacheCreationTokens * p.input * 1.25 +
      usage.cacheReadTokens * p.input * 0.1 +
      usage.outputTokens * p.output) /
    1_000_000
  );
}

export function creditsFor(usage: AiUsage, model: string): number {
  return Math.max(1, Math.ceil(usageCostUsd(usage, model) / USD_PER_CREDIT - 1e-9));
}

export function addUsage(a: AiUsage, b: AiUsage): AiUsage {
  const cost = a.costUsd != null || b.costUsd != null ? (a.costUsd ?? 0) + (b.costUsd ?? 0) : undefined;
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    cacheCreationTokens: a.cacheCreationTokens + b.cacheCreationTokens,
    cacheReadTokens: a.cacheReadTokens + b.cacheReadTokens,
    ...(cost != null ? { costUsd: cost } : {}),
  };
}

export const ZERO_USAGE: AiUsage = { inputTokens: 0, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0 };

/** One row per assistant reply (or "More titles" batch); Settings → Billing sums these. */
export function recordUsage(args: { chatId: string; messageId: string; usage: AiUsage; model: string }): number {
  const credits = creditsFor(args.usage, args.model);
  appDb()
    .prepare(
      `INSERT INTO credit_usage (id, chat_id, message_id, credits, input_tokens, output_tokens, model, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      newId(),
      args.chatId,
      args.messageId,
      credits,
      args.usage.inputTokens + args.usage.cacheCreationTokens + args.usage.cacheReadTokens,
      args.usage.outputTokens,
      args.model,
      nowIso(),
    );
  return credits;
}

type CreditSettings = { plan?: string; monthlyLimit?: number; periodEndsAt?: string | null };

/** Credits used in the current monthly period (period ends at settings.credits.periodEndsAt). */
export function creditStatus() {
  const s = getSetting<CreditSettings>("credits", {});
  const limit = s.monthlyLimit ?? 3000;
  let periodEnd = s.periodEndsAt ? new Date(s.periodEndsAt) : null;
  const now = new Date();
  if (!periodEnd || Number.isNaN(periodEnd.getTime())) {
    periodEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  }
  // Roll the stored period end forward month by month until it is in the future.
  while (periodEnd.getTime() <= now.getTime()) periodEnd.setUTCMonth(periodEnd.getUTCMonth() + 1);
  const periodStart = new Date(periodEnd);
  periodStart.setUTCMonth(periodStart.getUTCMonth() - 1);
  const row = appDb()
    .prepare("SELECT COALESCE(SUM(credits), 0) AS used FROM credit_usage WHERE created_at >= ? AND created_at < ?")
    .get(periodStart.toISOString(), periodEnd.toISOString()) as { used: number };
  const used = Number(row.used) || 0;
  return {
    plan: s.plan ?? "pro",
    creditLimit: limit,
    usedCredits: used,
    creditsRemaining: Math.max(0, limit - used),
    periodStartsAt: periodStart.toISOString(),
    periodEndsAt: periodEnd.toISOString(),
  };
}
