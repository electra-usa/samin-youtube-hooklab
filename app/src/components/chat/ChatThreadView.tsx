"use client";

import Link from "next/link";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { APP_NAME } from "@/lib/brand";
import { cn } from "@/lib/format";
import { thumbnailPrompt } from "@/lib/chat/constants";
import type { AngleCard, ChatMessageDTO, ChatTitle } from "@/lib/chat/types";
import type { LiveBatch, TitleHandlers } from "./AngleCards";
import { AttachmentDialogs } from "./AttachmentDialogs";
import { ChatComposer } from "./ChatComposer";
import { ChatHeader } from "./ChatHeader";
import { AssistantMessage, UserMessage, type ReplyView } from "./Message";
import { PinnedTitlesPanel } from "./PinnedTitlesPanel";
import { useChatAttachments } from "./useChatAttachments";
import { useChatThread } from "./useChatThread";

function savedView(m: ChatMessageDTO): ReplyView {
  return {
    id: m.id,
    content: m.content,
    cards: m.cards,
    videoMap: m.metadata?.videoMap ?? {},
    feedback: m.feedback,
    error: m.metadata?.error ?? null,
    cancelled: m.metadata?.cancelled,
  };
}

export function ChatThreadView({ chatId }: { chatId: string }) {
  const t = useChatThread(chatId);
  const files = useChatAttachments(chatId);
  const [input, setInput] = useState("");
  const [pinsOpen, setPinsOpen] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const { attachments: threadAttachments } = t;
  const { setAttachments } = files;

  // The composer shows the chat's saved attachments.
  useEffect(() => {
    setAttachments(threadAttachments);
  }, [threadAttachments, setAttachments]);

  const pinnedKeys = useMemo(() => new Set(t.pins.map((p) => `${p.messageId}::${p.title}`)), [t.pins]);

  const handlersFor = useCallback(
    (messageId: string): TitleHandlers => ({
      onThumbnail: (title) => t.send(thumbnailPrompt(title)),
      onTogglePin: (title: ChatTitle, card) => t.togglePin(messageId, title, card),
      isPinned: (title) => pinnedKeys.has(`${messageId}::${title.title}`),
      onMore: (card: AngleCard) => t.expandCard(messageId, card),
    }),
    [pinnedKeys, t],
  );

  const liveView: ReplyView | null = t.live
    ? {
        id: t.live.messageId,
        content: t.live.text,
        cards: t.live.cards.length ? { angleCards: [...t.live.cards].sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true })) } : null,
        videoMap: {},
        error: t.live.error,
        live: { stageLabel: t.liveStageLabel ?? "Thinking…", pendingTitles: t.live.titles, thumbnailTexts: t.live.thumbnailTexts },
      }
    : null;

  const expansionFor = (messageId: string): Record<string, LiveBatch> | undefined =>
    t.expansion && t.expansion.messageId === messageId
      ? { [t.expansion.cardId]: { titles: t.expansion.titles, stageLabel: t.expansionStageLabel, slots: t.expansionSlots } }
      : undefined;

  // Keep the newest content in view unless the reader scrolled up.
  useLayoutEffect(() => {
    const el = scroller.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  });

  const submit = () => {
    if (t.send(input)) {
      setInput("");
      stick.current = true;
    }
  };

  const lastAssistantId = [...t.messages].reverse().find((m) => m.role === "assistant")?.id;

  if (t.status === "missing") {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
        <p className="text-lg font-medium text-dark dark:text-white">This chat doesn&apos;t exist anymore.</p>
        <Link href="/chat" className="text-sm font-medium text-accent-blue-text hover:underline">
          Start a new chat
        </Link>
      </div>
    );
  }

  const retry = (index: number) => {
    const prevUser = [...t.messages.slice(0, index)].reverse().find((m) => m.role === "user");
    return prevUser ? () => t.send(prevUser.content) : undefined;
  };

  return (
    <div className={cn("relative flex h-full min-h-0 flex-col transition-[padding] duration-200", pinsOpen && "lg:pr-[320px]")}>
      {t.chat ? <ChatHeader chat={t.chat} onChange={t.setChat} /> : <div className="h-7" />}
      <div
        ref={scroller}
        data-chat-scroll-container="true"
        onScroll={(e) => {
          const el = e.currentTarget;
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 140;
        }}
        className="min-h-0 flex-1 overflow-y-auto overflow-x-clip scrollbar-thin"
      >
        <div role="log" aria-label="Chat conversation" className="mx-auto w-full max-w-[720px] space-y-4 px-4 py-6 sm:px-6">
          {t.status === "loading" && <p className="animate-pulse pl-5 text-xs text-[var(--color-muted)]">Loading chat…</p>}
          {t.messages.map((m, i) =>
            m.role === "user" ? (
              <UserMessage key={m.id} content={m.content} attachments={m.attachments} />
            ) : (
              <AssistantMessage
                key={m.id}
                view={savedView(m)}
                chatId={chatId}
                isLast={m.id === lastAssistantId && !t.live && !t.pendingUser}
                handlers={handlersFor(m.id)}
                expansions={expansionFor(m.id)}
                onFollowup={(text) => {
                  stick.current = true;
                  t.send(text);
                }}
                onRetry={m.metadata?.error ? retry(i) : undefined}
              />
            ),
          )}
          {t.pendingUser && <UserMessage content={t.pendingUser.content} />}
          {liveView && <AssistantMessage view={liveView} chatId={chatId} isLast handlers={handlersFor(liveView.id)} />}
          {t.background && !t.live && (
            <div className="pl-5" role="status" aria-live="polite">
              <span className="animate-pulse text-xs text-[var(--color-muted)]">Still writing this answer… it will appear here when it&apos;s done.</span>
            </div>
          )}
        </div>
      </div>
      <div className="shrink-0 bg-gradient-to-t from-white via-white/95 to-white/0 pt-2 dark:from-[#111214] dark:via-[#111214]/95 dark:to-transparent">
        <div className="mx-auto w-full max-w-[720px] px-4 pb-3 min-[850px]:px-6">
          <ChatComposer
            value={input}
            onChange={setInput}
            onSubmit={submit}
            placeholder={`Ask ${APP_NAME} to...`}
            isGenerating={t.isGenerating}
            onStop={t.stop}
            submitDisabled={files.busy}
            attachments={files.attachments}
            attachmentBusy={files.busy}
            onAddTranscriptFromUrl={() => files.setDialog({ type: "video-url" })}
            onAddPastedTranscript={() => files.setDialog({ type: "paste-transcript" })}
            onUploadFiles={files.uploadFiles}
            onRemoveAttachment={files.remove}
          />
        </div>
      </div>
      <PinnedTitlesPanel pins={t.pins} open={pinsOpen} onOpenChange={setPinsOpen} onUnpin={t.unpin} />
      <AttachmentDialogs
        state={files.dialog}
        busy={files.busy}
        onClose={() => files.setDialog(null)}
        onSubmitVideoUrl={files.attachVideoUrl}
        onSubmitPastedTranscript={files.attachPasted}
      />
    </div>
  );
}
