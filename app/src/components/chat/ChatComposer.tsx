"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowUp, FileText, Plus, Square, X } from "lucide-react";
import { Popover } from "@/components/ui/Popover";
import { cn } from "@/lib/format";
import { CHAT_MESSAGE_MAX_CHARS, UPLOAD_ACCEPT, UPLOAD_HELPER_TEXT } from "@/lib/chat/constants";
import type { ChatAttachment } from "@/lib/chat/types";

function MenuAction({ label, onSelect, close }: { label: string; onSelect?: () => void; close: () => void }) {
  return (
    <button
      type="button"
      onClick={() => {
        close();
        onSelect?.();
      }}
      className="flex w-full items-center rounded-lg px-3 py-2 text-left text-sm text-dark transition hover:bg-gray-100 dark:text-white dark:hover:bg-white/10"
    >
      {label}
    </button>
  );
}

// The "Ask … to…" box: "+" menu for context (transcript from URL, pasted transcript, file),
// auto-growing textarea, Send — or "Stop generating" while a reply streams.

export function ChatComposer({
  value,
  onChange,
  onSubmit,
  placeholder,
  disabled = false,
  submitDisabled = false,
  isGenerating = false,
  onStop,
  attachments = [],
  attachmentBusy = false,
  onAddTranscriptFromUrl,
  onAddPastedTranscript,
  onUploadFiles,
  onRemoveAttachment,
  autoFocus = false,
}: {
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  placeholder: string;
  disabled?: boolean;
  submitDisabled?: boolean;
  isGenerating?: boolean;
  onStop?: () => void;
  attachments?: ChatAttachment[];
  attachmentBusy?: boolean;
  onAddTranscriptFromUrl?: () => void;
  onAddPastedTranscript?: () => void;
  onUploadFiles?: (files: FileList) => void;
  onRemoveAttachment?: (id: string) => void;
  autoFocus?: boolean;
}) {
  const textarea = useRef<HTMLTextAreaElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const trimmed = value.trim();
  const tooLong = trimmed.length > CHAT_MESSAGE_MAX_CHARS;
  const canSend = (!!trimmed || attachments.length > 0) && !submitDisabled && !disabled && !tooLong;
  const attachDisabled = disabled || attachmentBusy;

  useEffect(() => {
    const el = textarea.current;
    if (!el) return;
    el.style.height = "auto";
    const h = Math.min(Math.max(el.scrollHeight, 20), 180);
    el.style.height = `${h}px`;
    el.style.overflowY = h >= 180 ? "auto" : "hidden";
  }, [value]);

  useEffect(() => {
    if (autoFocus) textarea.current?.focus();
  }, [autoFocus]);

  const openFilePicker = () => fileInput.current?.click();

  return (
    <div className="space-y-2">
      {(attachments.length > 0 || attachmentBusy) && (
        <div className="flex flex-wrap gap-2">
          {attachments.map((a) => (
            <span
              key={a.id}
              className="inline-flex max-w-[320px] items-center gap-2 rounded-xl border border-stroke bg-white px-3 py-1.5 text-xs text-dark shadow-sm dark:border-white/15 dark:bg-[#1b1c1f] dark:text-white"
              title={`${a.charCount.toLocaleString()} characters`}
            >
              <FileText className="size-4 shrink-0 text-dark-5" />
              <span className="truncate">{a.label ?? (a.type === "transcript" ? "Transcript" : "Document")}</span>
              {onRemoveAttachment && (
                <button type="button" onClick={() => onRemoveAttachment(a.id)} aria-label="Remove attachment" className="rounded p-0.5 text-dark-5 hover:bg-gray-100 hover:text-dark dark:hover:bg-white/10">
                  <X className="size-3.5" />
                </button>
              )}
            </span>
          ))}
          {attachmentBusy && <p className="animate-pulse self-center text-xs text-[var(--color-muted)]">Preparing attachment…</p>}
        </div>
      )}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (canSend) onSubmit();
        }}
        className="flex items-center gap-3 rounded-2xl border border-stroke bg-white px-4 py-2.5 shadow-sm dark:border-white/15 dark:bg-[#1b1c1f] dark:shadow-none"
      >
        {(onAddTranscriptFromUrl || onAddPastedTranscript || onUploadFiles) && (
          <>
            <input
              ref={fileInput}
              type="file"
              accept={UPLOAD_ACCEPT}
              multiple
              className="sr-only"
              aria-hidden
              tabIndex={-1}
              onChange={(e) => {
                if (e.target.files?.length) onUploadFiles?.(e.target.files);
                e.target.value = "";
              }}
            />
            <Popover
              open={menuOpen}
              onOpenChange={setMenuOpen}
              className="shrink-0 self-end min-[850px]:self-auto"
              panelClassName="bottom-full mb-2 mt-0 w-[280px]"
              trigger={({ toggle }) => (
                <button
                  type="button"
                  onClick={toggle}
                  disabled={attachDisabled}
                  aria-label="Add context"
                  className={cn(
                    "flex size-9 shrink-0 items-center justify-center rounded-full text-[var(--color-muted)] transition hover:bg-gray-100 hover:text-dark dark:hover:bg-white/10 dark:hover:text-white",
                    attachDisabled && "pointer-events-none opacity-50",
                  )}
                >
                  <Plus className="size-5" />
                </button>
              )}
            >
              <MenuAction label="Add transcript from YouTube video URL" onSelect={onAddTranscriptFromUrl} close={() => setMenuOpen(false)} />
              <MenuAction label="Paste transcript" onSelect={onAddPastedTranscript} close={() => setMenuOpen(false)} />
              <MenuAction label="Upload file" onSelect={openFilePicker} close={() => setMenuOpen(false)} />
              <p className="px-3 pb-2 pt-1 text-xs text-[var(--color-muted)]">{UPLOAD_HELPER_TEXT}</p>
            </Popover>
          </>
        )}
        <textarea
          ref={textarea}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              if (canSend && !isGenerating) onSubmit();
            }
          }}
          placeholder={placeholder}
          disabled={disabled}
          rows={1}
          aria-label="Message"
          className="block min-w-0 flex-1 resize-none border-0 bg-transparent py-0 text-base leading-6 text-dark outline-none placeholder:text-dark-5 sm:text-sm sm:leading-5 dark:text-white"
        />
        <div className="shrink-0 self-end min-[850px]:self-auto">
          {isGenerating && onStop ? (
            <button
              type="button"
              onClick={onStop}
              aria-label="Stop generating"
              title="Stop generating"
              className="flex size-9 shrink-0 items-center justify-center rounded-full bg-gray-800 text-white transition hover:bg-gray-900 dark:bg-gray-200 dark:text-dark dark:hover:bg-gray-300"
            >
              <Square className="size-3.5" fill="currentColor" />
            </button>
          ) : (
            <button
              type="submit"
              disabled={!canSend || isGenerating}
              aria-label="Send"
              className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-white dark:text-dark"
            >
              <ArrowUp className="size-[18px]" />
            </button>
          )}
        </div>
      </form>
      {trimmed.length >= 8000 && (
        <div className="flex items-start justify-between gap-3 px-1">
          <p className={cn("text-xs", tooLong ? "text-primary dark:text-white" : "text-[var(--color-muted)]")}>
            {tooLong ? 'Your message is too long. If it\'s a full transcript, use "Paste transcript" from the + menu instead.' : "Long message"}
          </p>
          <p className={cn("shrink-0 text-xs", tooLong ? "text-primary dark:text-white" : "text-[var(--color-muted)]")}>
            {trimmed.length.toLocaleString()} / {CHAT_MESSAGE_MAX_CHARS.toLocaleString()}
          </p>
        </div>
      )}
    </div>
  );
}
