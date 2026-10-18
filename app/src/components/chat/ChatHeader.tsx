"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Folder, FolderPlus, Pencil } from "lucide-react";
import { AddToProjectModal } from "@/components/projects/AddToProjectModal";
import { Popover } from "@/components/ui/Popover";
import { toast } from "@/components/ui/Toaster";
import { getJson } from "@/lib/api-client";
import { notifyChatsUpdated } from "@/lib/client-events";
import type { ChatMeta } from "@/lib/chat/types";
import { renameChat, setChatProject } from "./client";

type ProfileResponse = {
  channel: { name: string | null; avatar: string | null };
  profile: { profile?: { overview?: string }; primaryNiches?: string[] } | null;
  styleGuide: string | null;
};

function initials(name: string | null | undefined) {
  const parts = (name ?? "").trim().split(/\s+/).filter(Boolean);
  return (parts.length > 1 ? parts[0][0] + parts[1][0] : (parts[0] ?? "?").slice(0, 2)).toUpperCase();
}

function ChannelBadge({ chat }: { chat: ChatMeta }) {
  const [data, setData] = useState<ProfileResponse | null>(null);
  return (
    <Popover
      panelClassName="w-[320px] p-3"
      onOpenChange={(open) => {
        if (open && !data) {
          getJson<ProfileResponse>(`/api/chat/channel-profile${chat.channelId ? `?userChannelId=${chat.channelId}` : ""}`)
            .then(setData)
            .catch(() => {});
        }
      }}
      trigger={({ toggle }) => (
        <button type="button" onClick={toggle} aria-label="Open style guide" className="group flex shrink-0 items-center justify-center rounded-full transition-opacity hover:opacity-80">
          {chat.channelAvatar ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={chat.channelAvatar} alt="" className="size-5 rounded-full object-cover ring-2 ring-transparent group-hover:ring-primary" />
          ) : (
            <span className="flex size-5 items-center justify-center rounded-full bg-primary text-[9px] font-medium text-white ring-2 ring-transparent transition-all group-hover:ring-primary">
              {initials(chat.channelName)}
            </span>
          )}
        </button>
      )}
    >
      <div className="space-y-2 text-sm">
        <p className="font-medium text-dark dark:text-white">{chat.channelName ?? "Your channel"}</p>
        {data?.profile?.primaryNiches?.length ? <p className="text-xs text-[var(--color-muted)]">Niches: {data.profile.primaryNiches.join(", ")}</p> : null}
        <p className="text-xs leading-relaxed text-dark-5">{data ? (data.profile?.profile?.overview ?? "No channel profile yet.") : "Loading…"}</p>
        <p className="text-xs text-dark-5">
          <span className="font-medium text-dark dark:text-white">Style guide: </span>
          {data ? (data.styleGuide ? "set" : "not set") : "…"}
        </p>
        <Link href="/settings?tab=channels" className="inline-block text-xs font-medium text-accent-blue-text hover:underline">
          Edit profile & style guide in Settings
        </Link>
      </div>
    </Popover>
  );
}

export function ChatHeader({ chat, onChange }: { chat: ChatMeta; onChange: (chat: ChatMeta) => void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(chat.title);
  const [projectOpen, setProjectOpen] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) input.current?.select();
  }, [editing]);

  const save = async () => {
    const title = draft.trim();
    setEditing(false);
    if (!title || title === chat.title) return;
    onChange({ ...chat, title });
    try {
      await renameChat(chat.id, title);
      notifyChatsUpdated();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't rename the chat");
      onChange(chat);
    }
  };

  return (
    <div className="sticky top-0 z-20 flex items-center gap-2 bg-white/95 px-3 py-1 backdrop-blur supports-[backdrop-filter]:bg-white/90 sm:px-5 dark:bg-[#111214]/95">
      <ChannelBadge chat={chat} />
      <div className="group/title min-w-0 flex-1">
        {editing ? (
          <input
            ref={input}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={save}
            onKeyDown={(e) => {
              if (e.key === "Enter") save();
              if (e.key === "Escape") {
                setDraft(chat.title);
                setEditing(false);
              }
            }}
            aria-label="Chat name"
            className="w-full max-w-md rounded border border-stroke px-1.5 py-0.5 text-[13px] leading-5 text-dark outline-none focus:border-primary dark:border-white/15 dark:bg-transparent dark:text-white"
          />
        ) : (
          <button
            type="button"
            onClick={() => {
              setDraft(chat.title);
              setEditing(true);
            }}
            aria-label="Edit chat name"
            className="inline-flex min-w-0 max-w-full items-center gap-1 text-left text-[13px] leading-5 text-dark-5"
          >
            <span className="min-w-0 truncate">{chat.title}</span>
            <Pencil className="size-3 shrink-0 opacity-0 transition-opacity group-hover/title:opacity-70" />
          </button>
        )}
      </div>
      {chat.projectId && chat.projectName ? (
        <Link
          href={`/projects/${chat.projectId}`}
          className="inline-flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-medium text-dark-5 transition hover:bg-gray-100 hover:text-primary dark:hover:bg-white/10"
        >
          <Folder className="size-3.5" />
          {chat.projectName}
        </Link>
      ) : (
        <button
          type="button"
          onClick={() => setProjectOpen(true)}
          aria-label="Add to project"
          className="inline-flex shrink-0 items-center gap-1 rounded-full border border-transparent px-2.5 py-1 text-[11px] font-medium text-dark-5 transition hover:bg-gray-100 hover:text-primary dark:hover:bg-white/10"
        >
          <FolderPlus className="size-3.5" />
          <span>Add to project</span>
        </button>
      )}
      <AddToProjectModal
        open={projectOpen}
        onClose={() => setProjectOpen(false)}
        item={{ kind: "chat", refId: chat.id, label: chat.title }}
        onAdded={async (projectId) => {
          try {
            await setChatProject(chat.id, projectId);
          } catch {
            // the project item exists even if the chat link fails; the header just won't show it
          }
          const res = await fetch(`/api/chat/${chat.id}`, { cache: "no-store" }).then((r) => r.json()).catch(() => null);
          if (res?.chat) onChange(res.chat as ChatMeta);
          notifyChatsUpdated();
        }}
      />
    </div>
  );
}
