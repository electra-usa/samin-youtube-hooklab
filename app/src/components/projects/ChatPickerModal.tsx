"use client";

import { useEffect, useMemo, useState } from "react";
import { MessageSquare, Search } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { getJson } from "@/lib/api-client";
import { cn, timeAgo } from "@/lib/format";

type ChatRow = { id: string; title: string; projectId: string | null; updatedAt: string; messageCount: number };

/** Lists recent chats (GET /api/chats) so one can be filed into this project. */
export function ChatPickerModal({
  open,
  projectId,
  onClose,
  onPick,
}: {
  open: boolean;
  projectId: string;
  onClose: () => void;
  onPick: (chatId: string) => Promise<void>;
}) {
  if (!open) return null;
  return <Picker projectId={projectId} onClose={onClose} onPick={onPick} />;
}

function Picker({ projectId, onClose, onPick }: { projectId: string; onClose: () => void; onPick: (chatId: string) => Promise<void> }) {
  const [chats, setChats] = useState<ChatRow[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    getJson<{ chats: ChatRow[] }>("/api/chats?limit=200")
      .then((r) => alive && setChats(r.chats))
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, []);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (chats ?? []).filter((c) => c.projectId !== projectId && (!q || c.title.toLowerCase().includes(q)));
  }, [chats, query, projectId]);

  const pick = async (id: string) => {
    setBusy(id);
    try {
      await onPick(id);
    } finally {
      setBusy(null);
    }
  };

  return (
    <Modal open onClose={onClose} title="Add a chat to this project">
      <div className="relative mb-3">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-dark-5" aria-hidden />
        <input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Find a chat"
          aria-label="Find a chat"
          className="h-10 w-full rounded-lg border border-stroke bg-transparent pl-9 pr-3 text-sm text-dark outline-none focus:border-primary dark:border-white/15 dark:text-white"
        />
      </div>
      <div className="max-h-80 space-y-1 overflow-y-auto">
        {failed && <p className="py-6 text-center text-sm text-dark-5">Couldn&apos;t load your chats.</p>}
        {!failed && chats === null && <p className="py-6 text-center text-sm text-dark-5">Loading chats…</p>}
        {chats !== null && visible.length === 0 && (
          <p className="py-6 text-center text-sm text-dark-5">{chats.length ? "No other chats match." : "No chats yet."}</p>
        )}
        {visible.map((c) => (
          <button
            key={c.id}
            type="button"
            disabled={!!busy}
            onClick={() => pick(c.id)}
            className={cn(
              "flex w-full items-center gap-3 rounded-lg border border-transparent px-3 py-2.5 text-left transition hover:border-stroke hover:bg-gray-50 disabled:opacity-60 dark:hover:border-white/10 dark:hover:bg-white/5",
              busy === c.id && "border-primary/40 bg-primary/5",
            )}
          >
            <MessageSquare className="size-4 flex-shrink-0 text-dark-5" aria-hidden />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium text-dark dark:text-white">{c.title}</span>
              <span className="block text-xs text-dark-5">
                Updated {timeAgo(c.updatedAt)}
                {c.projectId ? " · moves it out of its current project" : ""}
              </span>
            </span>
            <span className="text-xs font-medium text-primary dark:text-sky-300">{busy === c.id ? "Adding…" : "Add"}</span>
          </button>
        ))}
      </div>
    </Modal>
  );
}
