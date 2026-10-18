"use client";

import { useState } from "react";
import { Copy, FileText, ThumbsDown, ThumbsUp } from "lucide-react";
import { toast } from "@/components/ui/Toaster";
import { TITLE_FEEDBACK_REASONS } from "@/lib/taxonomy";
import { cn } from "@/lib/format";
import { messageCopyText, videoMapById } from "@/lib/chat/format";
import type { AngleCard, AttachmentRef, ChatTitle, MessageCards, MessageFeedback, ThumbnailText, VideoMap } from "@/lib/chat/types";
import { AngleCardView, ThumbnailTextList, type LiveBatch, type TitleHandlers } from "./AngleCards";
import { copyText, sendFeedback } from "./client";
import { Markdown } from "./Markdown";

export function UserMessage({ content, attachments }: { content: string; attachments?: AttachmentRef[] | null }) {
  return (
    <div className="flex w-full justify-end" data-role="user">
      <div className="max-w-[85%] sm:max-w-[75%]">
        <div className="rounded-2xl rounded-br-none bg-gray-200 px-5 py-3 dark:bg-gray-700">
          <p className="whitespace-pre-wrap break-words text-base font-normal text-dark dark:text-white">{content}</p>
        </div>
        {attachments?.length ? (
          <div className="mt-1.5 flex flex-wrap justify-end gap-1.5">
            {attachments.map((a) => (
              <span key={a.id} className="inline-flex max-w-[260px] items-center gap-1 rounded-full border border-stroke px-2 py-0.5 text-[11px] text-dark-5 dark:border-white/15">
                <FileText className="size-3 shrink-0" />
                <span className="truncate">{a.label ?? (a.type === "transcript" ? "Transcript" : "Document")}</span>
              </span>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}

/** Everything an assistant reply can show, saved or streaming. */
export type ReplyView = {
  id: string;
  content: string;
  cards: MessageCards | null;
  videoMap: VideoMap;
  feedback?: MessageFeedback | null;
  error?: string | null;
  cancelled?: boolean;
  /** Present while the reply is streaming. */
  live?: {
    stageLabel: string;
    pendingTitles: ChatTitle[];
    thumbnailTexts: ThumbnailText[];
  };
};

/** Group streamed titles that don't have their card yet into placeholder cards. */
function buildingCards(titles: ChatTitle[], done: AngleCard[]): AngleCard[] {
  const byAngle = new Map<string, AngleCard>();
  for (const t of titles) {
    const angleIndex = t.id.split("_")[1];
    const cardId = `angle_${angleIndex}`;
    if (done.some((c) => c.id === cardId)) continue;
    const card = byAngle.get(cardId) ?? {
      id: cardId,
      name: t.angle ?? "New angle",
      emoji: t.angleEmoji ?? "💡",
      description: "",
      titles: [],
      isRecommended: false,
    };
    if (!card.titles.some((x) => x.id === t.id)) card.titles.push(t);
    byAngle.set(cardId, card);
  }
  return [...byAngle.values()];
}

export function AssistantMessage({
  view,
  chatId,
  isLast,
  handlers,
  expansions,
  onFollowup,
  onRetry,
}: {
  view: ReplyView;
  chatId: string;
  isLast: boolean;
  handlers: TitleHandlers;
  /** Streaming "More titles" batches keyed by card id. */
  expansions?: Record<string, LiveBatch>;
  onFollowup?: (text: string) => void;
  onRetry?: () => void;
}) {
  const { cards, live } = view;
  const doneCards = cards?.angleCards ?? [];
  const pending = live ? buildingCards(live.pendingTitles, doneCards) : [];
  const thumbnails = cards?.thumbnailTexts?.length ? cards.thumbnailTexts : (live?.thumbnailTexts ?? []);
  const structured = !!(cards?.summary || cards?.intro || doneCards.length || pending.length || thumbnails.length || cards?.bodyMarkdown);
  const intro = cards?.summary ?? cards?.intro;
  const videosById = videoMapById(view.videoMap);
  const followups = cards?.suggestedFollowups ?? [];
  const hasText = !!view.content.replace(/```[\s\S]*$/g, "").trim();

  return (
    <div className="flex w-full justify-start" data-role="assistant" data-message-id={view.id}>
      <div className="w-full">
        <div className="rounded-2xl rounded-tl-none px-5 py-3">
          <div className="min-w-0 space-y-3">
            {intro && structured && <p className="mb-3 text-base text-dark dark:text-white">{intro}</p>}
            {(doneCards.length > 0 || pending.length > 0) && (
              <div className="grid min-w-0 grid-cols-1 gap-3">
                {doneCards.map((card) => (
                  <AngleCardView
                    key={card.id}
                    card={card}
                    videoMap={view.videoMap}
                    handlers={live ? { ...handlers, onMore: undefined } : handlers}
                    batches={cards?.expansions?.[card.id] ?? []}
                    live={expansions?.[card.id] ?? null}
                  />
                ))}
                {pending.map((card) => (
                  <AngleCardView key={card.id} card={card} videoMap={view.videoMap} handlers={{ ...handlers, onMore: undefined }} building />
                ))}
              </div>
            )}
            {thumbnails.length > 0 && <ThumbnailTextList items={thumbnails} videoMap={view.videoMap} />}
            {cards?.bodyMarkdown?.trim() && structured && <Markdown text={cards.bodyMarkdown.trim()} videos={videosById} />}
            {!structured && hasText && !view.error && <Markdown text={view.content.replace(/```[\s\S]*$/g, "")} videos={videosById} />}
            {live && (
              <div className="flex items-center gap-3 py-1 pl-1" role="status" aria-live="polite">
                <span className="animate-pulse text-xs text-[var(--color-muted)]">{live.stageLabel}</span>
              </div>
            )}
            {view.error && (
              <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300">
                {view.error}
                {onRetry && (
                  <button type="button" onClick={onRetry} className="ml-2 font-medium underline">
                    Try again
                  </button>
                )}
              </div>
            )}
            {view.cancelled && !live && <p className="text-xs italic text-[var(--color-muted)]">Stopped{hasText || structured ? " — kept what was written so far." : "."}</p>}
            {!live && isLast && followups.length > 0 && onFollowup && (
              <div className="flex min-w-0 flex-wrap gap-2">
                {followups.map((f, i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() => onFollowup(f)}
                    className="rounded-full border border-gray-300 px-3 py-1.5 text-xs text-dark hover:bg-gray-100 dark:border-gray-600 dark:text-white dark:hover:bg-gray-700"
                  >
                    {f}
                  </button>
                ))}
              </div>
            )}
            {!live && !view.error && <MessageActions view={view} chatId={chatId} />}
          </div>
        </div>
      </div>
    </div>
  );
}

function MessageActions({ view, chatId }: { view: ReplyView; chatId: string }) {
  const [rating, setRating] = useState<"positive" | "negative" | null>(view.feedback?.rating ?? null);
  const [submitted, setSubmitted] = useState(!!view.feedback);
  const [formOpen, setFormOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (value: "positive" | "negative", why?: string, note?: string) => {
    setBusy(true);
    try {
      await sendFeedback({ chatMessageId: view.id, chatId, rating: value, reason: why || undefined, comment: note?.trim() || undefined });
      setRating(value);
      setSubmitted(true);
      setFormOpen(false);
    } catch {
      toast.error("Couldn't save feedback. Try again.");
    } finally {
      setBusy(false);
    }
  };

  const copy = async () => {
    if (await copyText(messageCopyText(view.content, view.cards))) toast.success("Message copied");
    else toast.error("Couldn't copy to the clipboard");
  };

  const copyButton = (
    <button type="button" onClick={copy} aria-label="Copy message" title="Copy message" className="rounded p-1 text-[var(--color-muted)] transition-colors hover:text-dark dark:hover:text-white">
      <Copy className="size-4" />
    </button>
  );

  if (submitted) {
    return (
      <div className="flex items-center gap-1 pt-1">
        {copyButton}
        {rating === "positive" ? <ThumbsUp className="size-4 text-green-600" fill="currentColor" /> : <ThumbsDown className="size-4 text-red-500" fill="currentColor" />}
        <p className="ml-1 text-xs text-[var(--color-muted)]">Thanks for the feedback!</p>
      </div>
    );
  }

  return (
    <div className="space-y-2 pt-1">
      <div className="flex items-center gap-1">
        {copyButton}
        <button
          type="button"
          aria-label="Good response"
          disabled={busy}
          onClick={() => submit("positive")}
          className={cn("rounded p-1 transition-colors", rating === "positive" ? "text-green-600" : "text-[var(--color-muted)] hover:text-dark dark:hover:text-white")}
        >
          <ThumbsUp className="size-4" />
        </button>
        <button
          type="button"
          aria-label="Poor response"
          disabled={busy}
          onClick={() => {
            setRating("negative");
            setFormOpen(true);
          }}
          className={cn("rounded p-1 transition-colors", rating === "negative" ? "text-red-500" : "text-[var(--color-muted)] hover:text-dark dark:hover:text-white")}
        >
          <ThumbsDown className="size-4" fill={rating === "negative" ? "currentColor" : "none"} />
        </button>
      </div>
      {formOpen && (
        <div className="space-y-2 rounded-lg border border-stroke bg-gray-50 p-3 dark:border-dark-3 dark:bg-dark-3">
          <p className="text-xs font-medium text-dark dark:text-white">What was the issue?</p>
          <select
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            className="w-full rounded-lg border border-stroke bg-white px-3 py-1.5 text-xs text-dark focus:border-primary focus:outline-none dark:border-dark-3 dark:bg-[#1b1c1f] dark:text-white"
          >
            <option value="">Select a reason…</option>
            {TITLE_FEEDBACK_REASONS.map((r) => (
              <option key={r.value} value={r.value}>
                {r.label}
              </option>
            ))}
          </select>
          <textarea
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            rows={2}
            placeholder="Anything else? (optional)"
            className="w-full resize-none rounded-lg border border-stroke bg-white px-3 py-1.5 text-xs text-dark placeholder:text-dark-5 focus:border-primary focus:outline-none dark:border-dark-3 dark:bg-[#1b1c1f] dark:text-white"
          />
          <div className="flex items-center gap-2">
            <button type="button" disabled={busy} onClick={() => submit("negative", reason, comment)} className="rounded-lg bg-primary px-3 py-1 text-xs font-medium text-white hover:bg-primary-hover disabled:opacity-60">
              {busy ? "Sending…" : "Submit"}
            </button>
            <button
              type="button"
              onClick={() => {
                setFormOpen(false);
                setRating(null);
                setReason("");
                setComment("");
              }}
              className="rounded-lg px-3 py-1 text-xs text-[var(--color-muted)] hover:text-dark dark:hover:text-white"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
