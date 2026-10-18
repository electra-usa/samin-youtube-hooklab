import type { Intent, StageName } from "./types";

// Limits mirror the original client (CHAT_MESSAGE_MAX_CHARS, PASTED_TRANSCRIPT_MAX_CHARS,
// the ~240K-character attachment budget).
export const CHAT_MESSAGE_MAX_CHARS = 10_000;
export const PASTED_TRANSCRIPT_MAX_CHARS = 200_000;
export const PASTED_TRANSCRIPT_MIN_CHARS = 50;
export const ATTACHMENT_TEXT_BUDGET_CHARS = 240_000;
export const UPLOAD_TEXT_MAX_BYTES = 2 * 1024 * 1024;
export const UPLOAD_ACCEPT = ".txt,.md,.markdown,.srt,.vtt,text/plain,text/markdown";
export const UPLOAD_HELPER_TEXT = "TXT, Markdown, SRT or VTT, up to 2 MB.";

/** Titles per "More titles →" batch. */
export const MORE_TITLES_BATCH = 4;

export function stageLabel(stage: StageName | null | undefined, intent?: Intent | null): string {
  switch (stage) {
    case "_preparing":
      return "Getting started…";
    case "_routing":
      return "Reading your request…";
    case "_loading_context":
      return "Loading your channel context…";
    case "_deep_research":
      return "Researching outliers…";
    case "_generating":
      if (intent === "titles" || intent === "more_titles") return "Writing titles…";
      if (intent === "thumbnail") return "Writing thumbnail text…";
      return "Writing…";
    default:
      return "Thinking…";
  }
}

/** Default chat title from the first message (same rule as the original client). */
export function defaultChatTitle(message: string): string {
  const trimmed = message.trim().replace(/\s+/g, " ");
  return trimmed ? trimmed.slice(0, 50) + (trimmed.length > 50 ? "…" : "") : "New chat";
}

export function thumbnailPrompt(title: string): string {
  return `Generate thumbnail text for this title: "${title}"`;
}

export function moreTitlesPrompt(angle: string): string {
  return `More titles for the "${angle}" angle`;
}
