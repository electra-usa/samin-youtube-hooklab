import type { z } from "zod";
import type { ProviderId } from "./config.ts";

export type Effort = "low" | "medium" | "high";

/** One prior turn of conversation, already rendered to text. */
export type AiTurn = { role: "user" | "assistant"; content: string };

export type AiUsage = {
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  /** Cost the provider reported itself (Claude Code CLI), at list prices. */
  costUsd?: number;
};

export type AiRequest = {
  /** Model override for this request (defaults to aiModel(): HOOKLAB_MODEL or claude-opus-5-5). */
  model?: string;
  system: string;
  messages: AiTurn[];
  effort: Effort;
  maxTokens: number;
  /** Structured output schema. When set, the response is JSON matching it. */
  schema?: z.ZodType;
  signal?: AbortSignal;
  /** Raw JSON text of a structured response as it streams. */
  onJsonDelta?: (chunk: string) => void;
  /** The provider restarted its structured output (e.g. a retry); drop anything parsed so far. */
  onJsonReset?: () => void;
  /** Plain-text deltas when no schema is set. */
  onTextDelta?: (chunk: string) => void;
};

export type AiResult = {
  provider: ProviderId;
  /** Model that produced the final answer (differs from the requested one after a fallback). */
  model: string;
  text: string;
  /** Parsed structured output (validated against the schema) when a schema was given. */
  json?: unknown;
  stopReason: string | null;
  usage: AiUsage;
};

export type AiErrorCode =
  | "no_provider"
  | "auth"
  | "rate_limit"
  | "overloaded"
  | "refusal"
  | "aborted"
  | "bad_output"
  | "timeout"
  | "api";

/** Errors carry a message that is safe to show in the chat. */
export class AiError extends Error {
  readonly code: AiErrorCode;
  readonly detail?: string;

  constructor(code: AiErrorCode, message: string, detail?: string) {
    super(message);
    this.name = "AiError";
    this.code = code;
    this.detail = detail;
  }
}
