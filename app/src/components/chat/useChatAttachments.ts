"use client";

import { useCallback, useState } from "react";
import { toast } from "@/components/ui/Toaster";
import type { ChatAttachment } from "@/lib/chat/types";
import type { AttachmentDialog } from "./AttachmentDialogs";
import { attachToChat, prepareTranscript, prepareUpload, removeAttachment } from "./client";

/**
 * Attachments for the composer. Without a chat yet they stay drafts and are sent with the
 * first message (POST /api/chat); inside a chat they're saved right away.
 */
export function useChatAttachments(chatId: string | null) {
  const [attachments, setAttachments] = useState<ChatAttachment[]>([]);
  const [busy, setBusy] = useState(false);
  const [dialog, setDialog] = useState<AttachmentDialog>(null);

  const keep = useCallback(
    async (draft: ChatAttachment) => {
      const saved = chatId ? (await attachToChat(chatId, draft)).attachment : draft;
      setAttachments((list) => [...list, saved]);
      return saved;
    },
    [chatId],
  );

  const run = useCallback(async (fn: () => Promise<void>) => {
    setBusy(true);
    try {
      await fn();
      return true;
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to attach.");
      return false;
    } finally {
      setBusy(false);
    }
  }, []);

  const attachVideoUrl = (url: string) =>
    run(async () => {
      const res = await prepareTranscript("youtube_url", url);
      await keep(res.attachment);
      if (res.truncated) toast.info("That transcript was very long, so only the first 200,000 characters were attached.");
    });

  const attachPasted = (text: string) => run(async () => void (await keep((await prepareTranscript("pasted", text)).attachment)));

  const uploadFiles = (files: FileList) =>
    run(async () => {
      for (const file of Array.from(files)) await keep((await prepareUpload(file)).attachment);
    });

  const remove = async (id: string) => {
    if (chatId && !id.startsWith("draft-")) {
      try {
        await removeAttachment(id);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Failed to remove attachment.");
        return;
      }
    }
    setAttachments((list) => list.filter((a) => a.id !== id));
  };

  return { attachments, setAttachments, busy, dialog, setDialog, attachVideoUrl, attachPasted, uploadFiles, remove };
}
