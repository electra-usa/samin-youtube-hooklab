"use client";

import { getJson, sendJson } from "@/lib/api-client";
import type { ChatAttachment, ChatThreadResponse, PinnedTitle, StreamEvent } from "@/lib/chat/types";

// Browser-side calls to the chat API, including the SSE reader for /api/chat/stream.

export type StreamBody = {
  chatId: string;
  message: string;
  assistantMessageId: string;
  generationId: string;
  userMessageId?: string;
  expand?: { messageId: string; cardId: string };
};

/** POST /api/chat/stream and hand each `data:` event to onEvent until the stream ends. */
export async function streamChat(body: StreamBody, onEvent: (event: StreamEvent) => void, signal?: AbortSignal): Promise<void> {
  const res = await fetch("/api/chat/stream", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok || !res.body) {
    const err = (await res.json().catch(() => ({}))) as { error?: string };
    throw Object.assign(new Error(err.error ?? `Request failed (${res.status})`), { status: res.status });
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let split: number;
    while ((split = buffer.indexOf("\n\n")) >= 0) {
      const block = buffer.slice(0, split);
      buffer = buffer.slice(split + 2);
      const data = block
        .split("\n")
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trimStart())
        .join("\n");
      if (!data) continue;
      try {
        onEvent(JSON.parse(data) as StreamEvent);
      } catch {
        // ignore a malformed event rather than dropping the stream
      }
    }
  }
}

export const fetchThread = (chatId: string) => getJson<ChatThreadResponse>(`/api/chat/${chatId}`, { cache: "no-store" });

export const cancelGeneration = (generationId: string) => sendJson<{ success: boolean }>("/api/chat/generations/cancel", "POST", { generationId });

export const renameChat = (chatId: string, title: string) => sendJson(`/api/chat/${chatId}`, "PATCH", { title });

export const setChatProject = (chatId: string, projectId: string | null) => sendJson(`/api/chat/${chatId}`, "PATCH", { projectId });

export const deleteChat = (chatId: string) => sendJson(`/api/chat/${chatId}`, "DELETE");

export const fetchPins = (chatId: string) => getJson<{ pins: PinnedTitle[] }>(`/api/chat/pins?chatId=${encodeURIComponent(chatId)}`);

export const pinTitle = (body: { chatId: string; messageId: string; title: string; angle?: string; clickTrigger?: string; cardKey?: string }) =>
  sendJson<{ pin: PinnedTitle; projectItemId: string | null }>("/api/chat/pins", "POST", body);

export const unpinTitle = (id: string) => sendJson(`/api/chat/pins?id=${encodeURIComponent(id)}`, "DELETE");

export const sendFeedback = (body: { chatMessageId: string; chatId: string; rating: "positive" | "negative"; reason?: string; comment?: string }) =>
  sendJson("/api/chat/feedback", "POST", body);

export const prepareTranscript = (sourceType: "youtube_url" | "pasted", value: string) =>
  sendJson<{ attachment: ChatAttachment; truncated?: boolean }>("/api/chat/attachments/prepare-transcript", "POST", { sourceType, value });

export async function prepareUpload(file: File): Promise<{ attachment: ChatAttachment }> {
  const form = new FormData();
  form.append("file", file);
  const res = await fetch("/api/chat/attachments/prepare-upload-text", { method: "POST", body: form });
  const body = (await res.json().catch(() => ({}))) as { attachment?: ChatAttachment; error?: string };
  if (!res.ok || !body.attachment) throw new Error(body.error ?? `Failed to attach ${file.name}.`);
  return { attachment: body.attachment };
}

export const attachToChat = (chatId: string, attachment: ChatAttachment) =>
  sendJson<{ attachment: ChatAttachment }>("/api/chat/attachments", "POST", { chatId, attachment });

export const removeAttachment = (id: string) => sendJson(`/api/chat/attachments/${id}`, "DELETE");

export function copyText(text: string): Promise<boolean> {
  if (navigator.clipboard?.writeText) return navigator.clipboard.writeText(text).then(() => true, () => false);
  return Promise.resolve(false);
}
