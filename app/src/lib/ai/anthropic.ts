import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { aiModel } from "./config.ts";
import { AiError, type AiRequest, type AiResult } from "./types.ts";

// Claude through the official SDK. `new Anthropic()` resolves ANTHROPIC_API_KEY,
// ANTHROPIC_AUTH_TOKEN or an `ant auth login` profile on its own.
// Opus 5.5 always thinks (adaptive); depth is set with output_config.effort. Server-side
// fallbacks ("default") retry policy declines on Anthropic's recommended model.

let client: Anthropic | null = null;
const getClient = () => (client ??= new Anthropic({ maxRetries: 2 }));

export async function runAnthropic(req: AiRequest): Promise<AiResult> {
  const model = req.model || aiModel();
  const format = req.schema ? betaZodOutputFormat(req.schema) : undefined;
  try {
    const stream = getClient().beta.messages.stream(
      {
        model,
        max_tokens: req.maxTokens,
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
        thinking: { type: "adaptive" },
        output_config: { effort: req.effort, ...(format ? { format } : {}) },
        system: [{ type: "text", text: req.system, cache_control: { type: "ephemeral" } }],
        messages: req.messages.map((m) => ({ role: m.role, content: m.content })),
      },
      { signal: req.signal },
    );

    for await (const event of stream) {
      if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
        if (req.schema) req.onJsonDelta?.(event.delta.text);
        else req.onTextDelta?.(event.delta.text);
      }
    }
    const message = await stream.finalMessage();

    // A refusal on the final message means every model in the fallback chain declined.
    if (message.stop_reason === "refusal") {
      throw new AiError(
        "refusal",
        "Claude declined this request. Try rephrasing it, or ask about a different angle of your video.",
        message.stop_details?.category ?? undefined,
      );
    }
    if (message.stop_reason === "max_tokens") {
      throw new AiError("bad_output", "The answer ran past the length limit. Try asking for less at once.");
    }

    const text = message.content
      .map((block) => (block.type === "text" ? block.text : ""))
      .join("");
    let json: unknown;
    if (req.schema) {
      try {
        const parsed = req.schema.safeParse(JSON.parse(text));
        if (!parsed.success) throw new Error(parsed.error.message);
        json = parsed.data;
      } catch (err) {
        throw new AiError("bad_output", "Claude's answer didn't come back in the expected format. Please try again.", String(err));
      }
    }
    const u = message.usage;
    return {
      provider: "anthropic",
      model: message.model,
      text,
      json,
      stopReason: message.stop_reason,
      usage: {
        inputTokens: u.input_tokens ?? 0,
        outputTokens: u.output_tokens ?? 0,
        cacheCreationTokens: u.cache_creation_input_tokens ?? 0,
        cacheReadTokens: u.cache_read_input_tokens ?? 0,
      },
    };
  } catch (err) {
    throw toAiError(err);
  }
}

function toAiError(err: unknown): AiError {
  if (err instanceof AiError) return err;
  if (err instanceof Anthropic.APIUserAbortError) return new AiError("aborted", "Stopped.");
  if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError) {
    return new AiError("auth", "Claude rejected HookLab's credentials. Check ANTHROPIC_API_KEY in app/.env.local.", err.message);
  }
  if (err instanceof Anthropic.RateLimitError) {
    return new AiError("rate_limit", "Claude is rate-limiting requests right now. Wait a minute and try again.", err.message);
  }
  if (err instanceof Anthropic.APIConnectionError) {
    return new AiError("api", "Couldn't connect to Claude. Check your internet connection and try again.", err.message);
  }
  if (err instanceof Anthropic.APIError) {
    if (err.status === 529) return new AiError("overloaded", "Claude is overloaded at the moment. Try again shortly.", err.message);
    return new AiError("api", `Claude returned an error (${err.status ?? "unknown"}). Please try again.`, err.message);
  }
  return new AiError("api", "Something went wrong while talking to Claude.", err instanceof Error ? err.message : String(err));
}
