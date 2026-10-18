import "server-only";
import { PASTED_TRANSCRIPT_MAX_CHARS, PASTED_TRANSCRIPT_MIN_CHARS } from "./constants";
import type { AttachmentSource, AttachmentType, ChatAttachment } from "./types";
import { subtitleToText } from "./youtube";

// Attachments are prepared first (prepare-transcript / prepare-upload-text return a draft),
// then saved with the chat: in POST /api/chat for a new chat, or POST /api/chat/attachments.

export type DraftAttachment = Omit<ChatAttachment, "id" | "createdAt" | "charCount" | "status">;

const SOURCES: AttachmentSource[] = ["youtube_url", "pasted", "upload"];

export function draftAttachment(args: {
  type: AttachmentType;
  sourceType: AttachmentSource;
  label: string | null;
  text: string;
  sourceUrl?: string | null;
  sourceVideoId?: string | null;
}): ChatAttachment {
  const now = new Date().toISOString();
  return {
    id: `draft-${crypto.randomUUID()}`,
    type: args.type,
    sourceType: args.sourceType,
    status: "ready",
    label: args.label,
    sourceUrl: args.sourceUrl ?? null,
    sourceVideoId: args.sourceVideoId ?? null,
    transcriptText: args.text,
    charCount: args.text.length,
    createdAt: now,
  };
}

/** Validate attachments sent by the client (drafts it got back from a prepare-* endpoint). */
export function normalizeDraftAttachments(raw: unknown): { ok: true; attachments: DraftAttachment[] } | { ok: false; error: string } {
  if (raw == null) return { ok: true, attachments: [] };
  if (!Array.isArray(raw)) return { ok: false, error: "attachments must be an array" };
  const out: DraftAttachment[] = [];
  for (const item of raw.slice(0, 10)) {
    const a = normalizeDraftAttachment(item);
    if (!a.ok) return a;
    out.push(a.attachment);
  }
  return { ok: true, attachments: out };
}

export function normalizeDraftAttachment(item: unknown): { ok: true; attachment: DraftAttachment } | { ok: false; error: string } {
  if (!item || typeof item !== "object") return { ok: false, error: "Invalid attachment" };
  const a = item as Record<string, unknown>;
  const text = typeof a.transcriptText === "string" ? a.transcriptText.trim() : "";
  if (!text) return { ok: false, error: "Attachment has no text" };
  if (text.length > PASTED_TRANSCRIPT_MAX_CHARS) {
    return { ok: false, error: `Attachments can be up to ${PASTED_TRANSCRIPT_MAX_CHARS.toLocaleString()} characters.` };
  }
  const sourceType = SOURCES.includes(a.sourceType as AttachmentSource) ? (a.sourceType as AttachmentSource) : "pasted";
  return {
    ok: true,
    attachment: {
      type: a.type === "document" ? "document" : "transcript",
      sourceType,
      label: typeof a.label === "string" && a.label.trim() ? a.label.trim().slice(0, 200) : null,
      sourceUrl: typeof a.sourceUrl === "string" ? a.sourceUrl.slice(0, 500) : null,
      sourceVideoId: typeof a.sourceVideoId === "string" ? a.sourceVideoId.slice(0, 20) : null,
      transcriptText: text,
    },
  };
}

export function pastedTranscript(value: string): ChatAttachment {
  const text = value.trim();
  if (text.length < PASTED_TRANSCRIPT_MIN_CHARS) throw new Error(`Paste at least ${PASTED_TRANSCRIPT_MIN_CHARS} characters of transcript.`);
  if (text.length > PASTED_TRANSCRIPT_MAX_CHARS) {
    throw new Error(`Your transcript is ${text.length.toLocaleString()} characters. Pasted transcripts can be up to ${PASTED_TRANSCRIPT_MAX_CHARS.toLocaleString()} characters.`);
  }
  const firstLine = text.split("\n").find((l) => l.trim())?.trim() ?? "";
  return draftAttachment({
    type: "transcript",
    sourceType: "pasted",
    label: `Pasted transcript${firstLine ? `: ${firstLine.slice(0, 48)}${firstLine.length > 48 ? "…" : ""}` : ""}`,
    text,
  });
}

/** Text from an uploaded TXT / Markdown / SRT / VTT file. */
export function uploadedText(name: string, raw: string): ChatAttachment {
  const lower = name.toLowerCase();
  const isSubtitle = lower.endsWith(".srt") || lower.endsWith(".vtt") || raw.startsWith("WEBVTT");
  const text = (isSubtitle ? subtitleToText(raw) : raw.replace(/\r\n/g, "\n")).trim();
  if (!text) throw new Error(`${name} has no readable text.`);
  if (text.length > PASTED_TRANSCRIPT_MAX_CHARS) {
    throw new Error(`${name} is ${text.length.toLocaleString()} characters. Files can be up to ${PASTED_TRANSCRIPT_MAX_CHARS.toLocaleString()} characters of text.`);
  }
  return draftAttachment({ type: isSubtitle ? "transcript" : "document", sourceType: "upload", label: name, text });
}
