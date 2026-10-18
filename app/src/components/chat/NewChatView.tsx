"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "@/components/ui/Toaster";
import { sendJson } from "@/lib/api-client";
import { APP_NAME } from "@/lib/brand";
import { notifyChatsUpdated } from "@/lib/client-events";
import { CHAT_MESSAGE_MAX_CHARS } from "@/lib/chat/constants";
import type { ChatAttachment, MessageCards, PromptPillMeta } from "@/lib/chat/types";
import { AttachmentDialogs } from "./AttachmentDialogs";
import { ChatComposer } from "./ChatComposer";
import { UserMessage } from "./Message";
import { useChatAttachments } from "./useChatAttachments";

export type ClientPill = { id: string; label: string; prompt: string; canned: { response: string; cards?: MessageCards } | null };

export function NewChatView({
  firstName,
  fixedPill,
  pills,
  pinCapabilities,
  channelId,
  initialPrompt,
  autoSend,
}: {
  firstName: string;
  fixedPill: ClientPill;
  /** The three pills after "Generate titles" (picked per request on the server). */
  pills: ClientPill[];
  pinCapabilities: boolean;
  channelId: string | null;
  initialPrompt: string | null;
  autoSend: boolean;
}) {
  const router = useRouter();
  const [input, setInput] = useState(() => (initialPrompt && !autoSend ? initialPrompt : ""));
  const [sending, setSending] = useState<string | null>(null);
  const files = useChatAttachments(null);
  const sentInitial = useRef(false);

  useEffect(() => {
    fetch("/api/chat/prewarm", { method: "POST", keepalive: true }).catch(() => {});
    fetch("/api/chat/stream", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ warmup: true, channelId }),
    }).catch(() => {});
  }, [channelId]);

  const send = useCallback(
    async (text: string, canned?: ClientPill["canned"], pill?: PromptPillMeta) => {
      const message = text.trim() || (files.attachments.length ? "Use the attached context." : "");
      if (!message || sending) return;
      if (message.length > CHAT_MESSAGE_MAX_CHARS) {
        toast.error(`Your message is ${message.length.toLocaleString()} characters. Chat messages can be up to ${CHAT_MESSAGE_MAX_CHARS.toLocaleString()} characters.`);
        return;
      }
      setSending(message);
      setInput("");
      // A canned pill answers without a model call — unless context is attached, which needs a real answer.
      const useCanned = canned?.response && !files.attachments.length ? canned : null;
      try {
        const res = await sendJson<{ data: { chatId: string; attachments: ChatAttachment[] } }>("/api/chat", "POST", {
          message,
          channelId: channelId ?? undefined,
          createOnly: true,
          attachments: files.attachments,
          ...(useCanned ? { assistantMessage: useCanned.response, ...(useCanned.cards ? { assistantCards: useCanned.cards } : {}) } : {}),
          ...(pill ? { promptPill: { ...pill, isCanned: !!useCanned } } : {}),
        });
        notifyChatsUpdated();
        router.push(`/chat/${res.data.chatId}`);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Something went wrong");
        setInput(message);
        setSending(null);
      }
    },
    [channelId, files.attachments, router, sending],
  );

  // /chat?prompt=… (from other pages) sends the prompt once; with &send=0 it only fills the box.
  useEffect(() => {
    if (!initialPrompt) return;
    window.history.replaceState(null, "", "/chat");
    if (!autoSend) return;
    const timer = setTimeout(() => {
      if (sentInitial.current) return;
      sentInitial.current = true;
      send(initialPrompt);
    }, 0);
    return () => clearTimeout(timer);
  }, [autoSend, initialPrompt, send]);

  const composer = (
    <ChatComposer
      value={input}
      onChange={setInput}
      onSubmit={() => send(input)}
      placeholder={`Ask ${APP_NAME} to...`}
      disabled={!!sending}
      submitDisabled={files.busy}
      attachments={files.attachments}
      attachmentBusy={files.busy}
      onAddTranscriptFromUrl={() => files.setDialog({ type: "video-url" })}
      onAddPastedTranscript={() => files.setDialog({ type: "paste-transcript" })}
      onUploadFiles={files.uploadFiles}
      onRemoveAttachment={files.remove}
      autoFocus
    />
  );

  const dialogs = (
    <AttachmentDialogs
      state={files.dialog}
      busy={files.busy}
      onClose={() => files.setDialog(null)}
      onSubmitVideoUrl={files.attachVideoUrl}
      onSubmitPastedTranscript={files.attachPasted}
    />
  );

  if (sending) {
    // Show the message right away while the chat is created, like the original.
    return (
      <div className="flex h-full min-h-0 flex-col">
        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-[720px] space-y-4 px-4 py-6 sm:px-6">
            <UserMessage content={sending} />
            <p className="animate-pulse pl-5 text-xs text-[var(--color-muted)]">Starting your chat…</p>
          </div>
        </div>
        <div className="mx-auto w-full max-w-[720px] px-4 pb-3 min-[850px]:px-6">{composer}</div>
      </div>
    );
  }

  const all = [fixedPill, ...pills];
  return (
    <div className="relative flex min-h-[calc(100vh-8rem)] flex-col items-center justify-center px-4 py-8">
      <div className="w-full max-w-4xl">
        <h1 className="mb-8 text-center text-xl font-medium text-dark sm:text-2xl dark:text-white">Hello {firstName}, let&apos;s work on your next video!</h1>
        <div className="mx-auto max-w-2xl">{composer}</div>
        {!input.trim() && (
          <div className="mt-4 flex flex-wrap justify-center gap-2">
            {all.map((p, i) => (
              <button
                key={p.id}
                type="button"
                onClick={() =>
                  send(p.prompt, p.canned, {
                    promptId: p.id,
                    label: p.label,
                    prompt: p.prompt,
                    isCanned: !!p.canned?.response,
                    wasPinned: pinCapabilities && p.id === "chat_capabilities",
                    isFixed: p.id === fixedPill.id,
                    slotIndex: i,
                    messageDepth: 0,
                  })
                }
                className="rounded-full border border-gray-300 px-3 py-1.5 text-xs text-dark transition-colors hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-600 dark:text-white dark:hover:bg-gray-700"
              >
                {p.label}
              </button>
            ))}
          </div>
        )}
      </div>
      {dialogs}
    </div>
  );
}
