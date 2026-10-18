"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { FolderPlus, Pencil, Search, Trash } from "lucide-react";
import { AddToProjectModal } from "@/components/projects/AddToProjectModal";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { toast } from "@/components/ui/Toaster";
import { getJson } from "@/lib/api-client";
import { CHATS_UPDATED, notifyChatsUpdated } from "@/lib/client-events";
import { timeAgo } from "@/lib/format";
import { deleteChat, renameChat, setChatProject } from "./client";

type ChatRow = { id: string; title: string; projectId: string | null; updatedAt: string; messageCount: number };

// "View all" chats: search, rename, delete, add to project.
export function ChatsList() {
  const [chats, setChats] = useState<ChatRow[] | null>(null);
  const [query, setQuery] = useState("");
  const [renaming, setRenaming] = useState<ChatRow | null>(null);
  const [draft, setDraft] = useState("");
  const [deleting, setDeleting] = useState<ChatRow | null>(null);
  const [projectFor, setProjectFor] = useState<ChatRow | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(
    () =>
      getJson<{ chats: ChatRow[] }>("/api/chats?limit=500", { cache: "no-store" })
        .then((r) => setChats(r.chats))
        .catch(() => setChats([])),
    [],
  );

  useEffect(() => {
    load();
    window.addEventListener(CHATS_UPDATED, load);
    return () => window.removeEventListener(CHATS_UPDATED, load);
  }, [load]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (chats ?? []).filter((c) => !q || c.title.toLowerCase().includes(q));
  }, [chats, query]);

  const saveRename = async () => {
    if (!renaming) return;
    const title = draft.trim();
    if (!title) return;
    setBusy(true);
    try {
      await renameChat(renaming.id, title);
      notifyChatsUpdated();
      setRenaming(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't rename the chat");
    } finally {
      setBusy(false);
    }
  };

  const confirmDelete = async () => {
    if (!deleting) return;
    setBusy(true);
    try {
      await deleteChat(deleting.id);
      setChats((list) => (list ?? []).filter((c) => c.id !== deleting.id));
      notifyChatsUpdated();
      toast.success("Chat deleted");
      setDeleting(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't delete the chat");
    } finally {
      setBusy(false);
    }
  };

  const iconBtn = "rounded p-2 text-dark-5 transition-colors hover:bg-gray-100 dark:hover:bg-white/10";

  return (
    <div className="p-4 md:p-6 2xl:p-10">
      <div className="mx-auto max-w-3xl">
        <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <h1 className="text-2xl font-semibold text-dark dark:text-white">Chats</h1>
          <Link href="/chat" className="inline-flex items-center justify-center gap-2.5 rounded-lg bg-primary px-10 py-3.5 font-medium text-white transition hover:bg-primary-hover">
            + New chat
          </Link>
        </div>
        <div className="relative mb-6">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 size-[18px] -translate-y-1/2 text-dark-5" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search your chats..."
            aria-label="Search your chats"
            className="w-full rounded-lg border border-stroke bg-transparent py-3 pl-10 pr-4 text-dark outline-none transition placeholder:text-dark-5 focus:border-primary dark:border-white/15 dark:text-white"
          />
        </div>
        {chats === null ? (
          <p className="text-sm text-dark-5">Loading chats…</p>
        ) : (
          <>
            <p className="mb-4 text-sm text-dark-5">
              {visible.length} {visible.length === 1 ? "chat" : "chats"}
            </p>
            {visible.length === 0 ? (
              <div className="rounded-lg border border-dashed border-stroke px-6 py-12 text-center dark:border-white/15">
                <p className="font-medium text-dark dark:text-white">{query ? "No chats match your search." : "No chats yet."}</p>
                {!query && (
                  <Link href="/chat" className="mt-2 inline-block text-sm font-medium text-accent-blue-text hover:underline">
                    Start your first chat
                  </Link>
                )}
              </div>
            ) : (
              <ul role="list" className="divide-y divide-stroke dark:divide-white/10">
                {visible.map((c) => (
                  <li key={c.id} className="group">
                    <div className="flex items-center gap-3 py-4">
                      <Link href={`/chat/${c.id}`} className="min-w-0 flex-1 transition hover:opacity-80">
                        <span className="block truncate font-medium text-dark dark:text-white">{c.title}</span>
                        <span className="mt-0.5 block text-sm text-dark-5">Last message {timeAgo(c.updatedAt)}</span>
                      </Link>
                      <button type="button" aria-label={`Add "${c.title}" to a project`} onClick={() => setProjectFor(c)} className={`${iconBtn} hover:text-accent-blue-text`}>
                        <FolderPlus className="size-4" />
                      </button>
                      <div className="flex shrink-0 items-center gap-1 opacity-0 transition group-hover:opacity-100 focus-within:opacity-100">
                        <button
                          type="button"
                          aria-label={`Rename "${c.title}"`}
                          onClick={() => {
                            setRenaming(c);
                            setDraft(c.title);
                          }}
                          className={`${iconBtn} hover:text-dark dark:hover:text-white`}
                        >
                          <Pencil className="size-4" />
                        </button>
                        <button type="button" aria-label={`Delete "${c.title}"`} onClick={() => setDeleting(c)} className={`${iconBtn} hover:bg-red-500/10 hover:text-red-600`}>
                          <Trash className="size-4" />
                        </button>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>

      <Modal
        open={!!renaming}
        onClose={() => setRenaming(null)}
        title="Rename chat"
        size="sm"
        footer={
          <>
            <Button variant="soft" size="sm" onClick={() => setRenaming(null)}>
              Cancel
            </Button>
            <Button size="sm" onClick={saveRename} disabled={busy || !draft.trim()}>
              {busy ? "Saving…" : "Save"}
            </Button>
          </>
        }
      >
        <input
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && saveRename()}
          aria-label="Chat name"
          className="h-10 w-full rounded-lg border border-stroke px-3 text-sm outline-none focus:border-primary dark:border-white/15 dark:bg-transparent"
        />
      </Modal>

      <Modal
        open={!!deleting}
        onClose={() => setDeleting(null)}
        title="Delete chat?"
        size="sm"
        footer={
          <>
            <Button variant="soft" size="sm" onClick={() => setDeleting(null)}>
              Cancel
            </Button>
            <Button variant="danger" size="sm" onClick={confirmDelete} disabled={busy}>
              {busy ? "Deleting…" : "Delete"}
            </Button>
          </>
        }
      >
        <p className="text-sm text-dark-5">
          &ldquo;{deleting?.title}&rdquo; and its messages, attachments and pinned titles will be removed. This can&apos;t be undone.
        </p>
      </Modal>

      {projectFor && (
        <AddToProjectModal
          open
          onClose={() => setProjectFor(null)}
          item={{ kind: "chat", refId: projectFor.id, label: projectFor.title }}
          onAdded={async (projectId) => {
            await setChatProject(projectFor.id, projectId).catch(() => {});
            notifyChatsUpdated();
          }}
        />
      )}
    </div>
  );
}
