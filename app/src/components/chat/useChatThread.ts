"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "@/components/ui/Toaster";
import { notifyChatsUpdated } from "@/lib/client-events";
import { MORE_TITLES_BATCH, moreTitlesPrompt, stageLabel } from "@/lib/chat/constants";
import type {
  ActiveGeneration,
  AngleCard,
  ChatAttachment,
  ChatThreadResponse,
  ChatMessageDTO,
  ChatMeta,
  ChatTitle,
  Intent,
  PinnedTitle,
  StageName,
  StreamEvent,
  ThumbnailText,
} from "@/lib/chat/types";
import { cancelGeneration, fetchPins, fetchThread, pinTitle, streamChat, unpinTitle } from "./client";

// Client state for one chat thread: saved messages, the reply streaming right now,
// "More titles" batches, pins, and the background-generation case after a reload.

export type LiveReply = {
  messageId: string;
  generationId: string;
  stage: StageName | null;
  intent: Intent | null;
  titles: ChatTitle[];
  cards: AngleCard[];
  thumbnailTexts: ThumbnailText[];
  text: string;
  error: string | null;
  stopping: boolean;
};

export type LiveExpansion = { messageId: string; cardId: string; generationId: string; titles: ChatTitle[]; stage: StageName | null };

// Guards against starting the same pending reply twice (React dev double effects, remounts).
const autoStarted = new Set<string>();

const uuid = () => crypto.randomUUID();

export function useChatThread(chatId: string) {
  const [chat, setChat] = useState<ChatMeta | null>(null);
  const [messages, setMessages] = useState<ChatMessageDTO[]>([]);
  const [attachments, setAttachments] = useState<ChatAttachment[]>([]);
  const [status, setStatus] = useState<"loading" | "ready" | "missing">("loading");
  const [live, setLive] = useState<LiveReply | null>(null);
  const [pendingUser, setPendingUser] = useState<ChatMessageDTO | null>(null);
  const [expansion, setExpansion] = useState<LiveExpansion | null>(null);
  const [background, setBackground] = useState<ActiveGeneration | null>(null);
  const [pins, setPins] = useState<PinnedTitle[]>([]);
  const busy = useRef(false);

  const apply = useCallback((data: ChatThreadResponse) => {
    setChat(data.chat);
    setMessages(data.messages);
    setAttachments(data.attachments);
    setBackground(data.activeGeneration);
  }, []);

  const refresh = useCallback(async () => {
    const data = await fetchThread(chatId);
    apply(data);
    return data;
  }, [apply, chatId]);

  const loadPins = useCallback(() => fetchPins(chatId).then((r) => setPins(r.pins)).catch(() => {}), [chatId]);

  const run = useCallback(
    async (body: { message: string; userMessageId?: string; optimistic?: boolean }) => {
      if (busy.current) return;
      busy.current = true;
      const messageId = uuid();
      const generationId = uuid();
      if (body.optimistic && body.userMessageId) {
        setPendingUser({
          id: body.userMessageId,
          role: "user",
          content: body.message,
          cards: null,
          metadata: null,
          attachments: null,
          promptPill: null,
          feedback: null,
          createdAt: new Date().toISOString(),
        });
      }
      setLive({ messageId, generationId, stage: "_preparing", intent: null, titles: [], cards: [], thumbnailTexts: [], text: "", error: null, stopping: false });
      const onEvent = (ev: StreamEvent) => {
        if ("tool_status" in ev) {
          setLive((l) => (l ? { ...l, stage: ev.tool_name, intent: ev.intent ?? l.intent } : l));
        } else if ("title" in ev) {
          setLive((l) => (l ? { ...l, titles: [...l.titles.filter((t) => t.id !== ev.title.id), ev.title] } : l));
        } else if ("card" in ev) {
          setLive((l) => (l ? { ...l, cards: [...l.cards.filter((c) => c.id !== ev.card.id), ev.card] } : l));
        } else if ("thumbnail_text" in ev) {
          setLive((l) => (l ? { ...l, thumbnailTexts: [...l.thumbnailTexts.filter((t) => t.id !== ev.thumbnail_text.id), ev.thumbnail_text] } : l));
        } else if ("text_delta" in ev) {
          setLive((l) => (l ? { ...l, text: l.text + ev.text_delta } : l));
        } else if ("chat_title" in ev) {
          setChat((c) => (c ? { ...c, title: ev.chat_title } : c));
          notifyChatsUpdated();
        } else if ("error" in ev) {
          setLive((l) => (l ? { ...l, error: ev.error } : l));
        }
      };
      try {
        await streamChat({ chatId, message: body.message, assistantMessageId: messageId, generationId, userMessageId: body.userMessageId }, onEvent);
      } catch (err) {
        const status = (err as { status?: number }).status;
        if (status !== 409) toast.error(err instanceof Error ? err.message : "The reply failed. Please try again.");
      } finally {
        busy.current = false;
        try {
          await refresh();
        } catch {
          // keep what we have if the refresh fails
        }
        setLive(null);
        setPendingUser(null);
        notifyChatsUpdated();
      }
    },
    [chatId, refresh],
  );

  // Load, then answer a pending first message (created on /chat) or follow a background reply.
  useEffect(() => {
    let cancelled = false;
    fetch("/api/chat/prewarm", { method: "POST", keepalive: true }).catch(() => {});
    fetchThread(chatId)
      .then((data) => {
        if (cancelled) return;
        apply(data);
        setStatus("ready");
        const last = data.messages[data.messages.length - 1];
        if (!data.activeGeneration && last?.role === "user" && !autoStarted.has(last.id)) {
          autoStarted.add(last.id);
          run({ message: last.content });
        }
      })
      .catch(() => !cancelled && setStatus("missing"));
    fetchPins(chatId)
      .then((r) => !cancelled && setPins(r.pins))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [apply, chatId, run]);

  // A reply that kept running after a reload: poll until it lands.
  useEffect(() => {
    if (!background || live) return;
    const timer = setInterval(() => {
      refresh().catch(() => {});
    }, 2000);
    return () => clearInterval(timer);
  }, [background, live, refresh]);

  const send = useCallback(
    (text: string) => {
      const message = text.trim();
      if (!message || busy.current || background) return false;
      run({ message, userMessageId: uuid(), optimistic: true });
      return true;
    },
    [background, run],
  );

  const stop = useCallback(async () => {
    const id = live?.generationId ?? expansion?.generationId ?? background?.id;
    if (!id) return;
    setLive((l) => (l ? { ...l, stopping: true } : l));
    try {
      await cancelGeneration(id);
      if (!live && !expansion) await refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't stop the reply");
    }
  }, [background, expansion, live, refresh]);

  const expandCard = useCallback(
    async (messageId: string, card: AngleCard) => {
      if (busy.current) return;
      busy.current = true;
      const generationId = uuid();
      setExpansion({ messageId, cardId: card.id, generationId, titles: [], stage: "_preparing" });
      try {
        await streamChat(
          { chatId, message: moreTitlesPrompt(card.name), assistantMessageId: uuid(), generationId, expand: { messageId, cardId: card.id } },
          (ev) => {
            if ("tool_status" in ev) setExpansion((x) => (x ? { ...x, stage: ev.tool_name } : x));
            else if ("title" in ev) setExpansion((x) => (x ? { ...x, titles: [...x.titles.filter((t) => t.id !== ev.title.id), ev.title] } : x));
            else if ("error" in ev) toast.error(ev.error);
          },
        );
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Couldn't get more titles");
      } finally {
        busy.current = false;
        await refresh().catch(() => {});
        setExpansion(null);
      }
    },
    [chatId, refresh],
  );

  const togglePin = useCallback(
    async (messageId: string, title: ChatTitle, card: { id: string; name: string }) => {
      const existing = pins.find((p) => p.messageId === messageId && p.title === title.title);
      try {
        if (existing) {
          setPins((list) => list.filter((p) => p.id !== existing.id));
          await unpinTitle(existing.id);
        } else {
          const res = await pinTitle({ chatId, messageId, title: title.title, angle: title.angle ?? card.name, clickTrigger: title.clickTrigger, cardKey: `${messageId}::${card.id}` });
          setPins((list) => [res.pin, ...list]);
          toast.success(res.projectItemId ? "Pinned and added to the project" : "Title pinned");
        }
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Couldn't update the pin");
        loadPins();
      }
    },
    [chatId, loadPins, pins],
  );

  const unpin = useCallback(
    async (pinId: string) => {
      setPins((list) => list.filter((p) => p.id !== pinId));
      await unpinTitle(pinId).catch(() => loadPins());
    },
    [loadPins],
  );

  return {
    chat,
    setChat,
    messages,
    attachments,
    setAttachments,
    status,
    live,
    liveStageLabel: live ? (live.stopping ? "Stopping…" : stageLabel(live.stage, live.intent)) : null,
    pendingUser,
    expansion,
    expansionStageLabel: expansion ? stageLabel(expansion.stage, "more_titles") : null,
    expansionSlots: MORE_TITLES_BATCH,
    background,
    pins,
    send,
    stop,
    expandCard,
    togglePin,
    unpin,
    refresh,
    isGenerating: !!live || !!expansion || !!background,
  };
}
