"use client";

import { useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { PASTED_TRANSCRIPT_MAX_CHARS, PASTED_TRANSCRIPT_MIN_CHARS } from "@/lib/chat/constants";

export type AttachmentDialog = { type: "video-url" } | { type: "paste-transcript" } | null;

type Props = {
  state: AttachmentDialog;
  busy: boolean;
  onClose: () => void;
  onSubmitVideoUrl: (url: string) => Promise<boolean>;
  onSubmitPastedTranscript: (text: string) => Promise<boolean>;
};

// "Attach transcript from video URL" and "Paste transcript" dialogs from the composer's + menu.
// Each dialog mounts fresh when opened, so its field starts empty.
export function AttachmentDialogs(props: Props) {
  if (props.state?.type === "video-url") return <VideoUrlDialog {...props} />;
  if (props.state?.type === "paste-transcript") return <PasteDialog {...props} />;
  return null;
}

function VideoUrlDialog({ busy, onClose, onSubmitVideoUrl }: Props) {
  const [url, setUrl] = useState("");
  const submit = async () => {
    if (url.trim() && !busy && (await onSubmitVideoUrl(url.trim()))) onClose();
  };
  return (
    <Modal
      open
      onClose={onClose}
      title="Attach transcript from video URL"
      footer={
        <>
          <Button variant="soft" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button size="sm" disabled={busy || !url.trim()} onClick={submit}>
            {busy ? "Attaching..." : "Attach transcript"}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <p className="text-sm text-[var(--color-muted)]">Paste a YouTube video URL and we&apos;ll pull the transcript into this chat.</p>
        <input
          type="url"
          autoFocus
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submit()}
          placeholder="https://www.youtube.com/watch?v=..."
          className="w-full rounded-lg border border-stroke bg-white px-4 py-3 text-sm text-dark outline-none placeholder:text-dark-5 focus:border-primary dark:border-white/15 dark:bg-transparent dark:text-white"
        />
      </div>
    </Modal>
  );
}

function PasteDialog({ busy, onClose, onSubmitPastedTranscript }: Props) {
  const [text, setText] = useState("");
  return (
    <Modal
      open
      onClose={onClose}
      title="Paste transcript"
      size="lg"
      footer={
        <>
          <Button variant="soft" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button
            size="sm"
            disabled={busy || text.trim().length < PASTED_TRANSCRIPT_MIN_CHARS}
            onClick={async () => (await onSubmitPastedTranscript(text.trim())) && onClose()}
          >
            {busy ? "Attaching..." : "Attach transcript"}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <p className="text-sm text-[var(--color-muted)]">
          Paste your full transcript here and we&apos;ll attach it as context for this chat. This supports up to{" "}
          {PASTED_TRANSCRIPT_MAX_CHARS.toLocaleString()} characters.
        </p>
        <textarea
          autoFocus
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={12}
          placeholder="Paste the full transcript..."
          className="w-full rounded-lg border border-stroke bg-white px-4 py-3 text-sm text-dark outline-none placeholder:text-dark-5 focus:border-primary dark:border-white/15 dark:bg-transparent dark:text-white"
        />
        <p className="text-right text-xs text-[var(--color-muted)]">{text.trim().length.toLocaleString()} characters</p>
      </div>
    </Modal>
  );
}
