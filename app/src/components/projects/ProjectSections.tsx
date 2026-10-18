"use client";

import { useState, type FormEvent, type ReactNode } from "react";
import Link from "next/link";
import {
  Copy,
  ExternalLink,
  LayoutTemplate,
  MessageSquare,
  NotebookPen,
  PenLine,
  Pin,
  Plus,
  Trash2,
  Type,
  Video,
  X,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Tooltip } from "@/components/ui/Tooltip";
import { toast } from "@/components/ui/Toaster";
import { ThumbAction, VideoCard } from "@/components/video/VideoCard";
import { cn, timeAgo } from "@/lib/format";
import type {
  ProjectChatEntry,
  ProjectNoteEntry,
  ProjectStudioEntry,
  ProjectTitleEntry,
  ProjectVideoEntry,
} from "@/lib/projects/types";

export function Section({
  title,
  icon: Icon,
  count,
  actions,
  children,
}: {
  title: string;
  icon: LucideIcon;
  count: number;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="rounded-xl border border-stroke bg-white p-5 dark:border-white/10 dark:bg-[#18191c]">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 text-base font-semibold text-dark dark:text-white">
          <Icon className="size-4 text-dark-5" aria-hidden />
          {title}
          <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-dark-5 dark:bg-white/10">{count}</span>
        </h2>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
      {children}
    </section>
  );
}

function Empty({ children }: { children: ReactNode }) {
  return <div className="rounded-lg border border-dashed border-stroke px-4 py-6 text-center text-sm text-dark-5 dark:border-white/15">{children}</div>;
}

function IconButton({ label, onClick, children, danger }: { label: string; onClick: () => void; children: ReactNode; danger?: boolean }) {
  return (
    <Tooltip content={label}>
      <button
        type="button"
        aria-label={label}
        onClick={onClick}
        className={cn(
          "rounded-md p-1.5 text-dark-5 transition hover:bg-gray-100 dark:hover:bg-white/10",
          danger ? "hover:text-red-600" : "hover:text-dark dark:hover:text-white",
        )}
      >
        {children}
      </button>
    </Tooltip>
  );
}

const linkButton =
  "inline-flex h-8 items-center gap-1.5 rounded-lg border border-stroke bg-white px-3 text-xs font-medium text-dark transition hover:bg-gray-50 dark:border-white/15 dark:bg-transparent dark:text-white dark:hover:bg-white/5";
const primaryLinkButton =
  "inline-flex h-8 items-center gap-1.5 rounded-lg bg-primary px-3 text-xs font-medium text-white transition hover:bg-primary-hover";

export function ChatsSection({
  projectId,
  chats,
  onAddExisting,
  onRemove,
}: {
  projectId: string;
  chats: ProjectChatEntry[];
  onAddExisting: () => void;
  onRemove: (entryId: string) => void;
}) {
  return (
    <Section
      title="Chats"
      icon={MessageSquare}
      count={chats.length}
      actions={
        <>
          <Button variant="soft" size="sm" onClick={onAddExisting}>
            Add existing chat
          </Button>
          <Link href={`/chat?projectId=${projectId}`} className={primaryLinkButton}>
            <Plus className="size-3.5" /> New chat in this project
          </Link>
        </>
      }
    >
      {chats.length === 0 ? (
        <Empty>No chats yet. Start a new one here or add an existing chat.</Empty>
      ) : (
        <ul className="divide-y divide-stroke dark:divide-white/10">
          {chats.map((c) => (
            <li key={c.entryId} className="flex items-center gap-3 py-2.5">
              <MessageSquare className="size-4 flex-shrink-0 text-dark-5" aria-hidden />
              <Link href={`/chat/${c.id}`} className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-dark hover:underline dark:text-white">{c.title}</span>
                <span className="block text-xs text-dark-5" suppressHydrationWarning>
                  {c.messageCount} {c.messageCount === 1 ? "message" : "messages"} · Updated {timeAgo(c.updatedAt)}
                </span>
              </Link>
              <IconButton label="Remove from project" onClick={() => onRemove(c.entryId)}>
                <X className="size-4" />
              </IconButton>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

export function TitlesSection({
  titles,
  onAdd,
  onRemove,
}: {
  titles: ProjectTitleEntry[];
  onAdd: (title: string) => Promise<boolean>;
  onRemove: (entryId: string) => void;
}) {
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!draft.trim()) return;
    setBusy(true);
    if (await onAdd(draft.trim())) setDraft("");
    setBusy(false);
  };
  const copy = (title: string) =>
    navigator.clipboard.writeText(title).then(
      () => toast.success("Title copied"),
      () => toast.error("Couldn't copy"),
    );

  return (
    <Section title="Saved titles" icon={Type} count={titles.length}>
      <form onSubmit={submit} className="mb-4 flex gap-2">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Add a title idea"
          aria-label="New title idea"
          maxLength={200}
          className="h-10 min-w-0 flex-1 rounded-lg border border-stroke bg-transparent px-3 text-sm text-dark outline-none transition placeholder:text-dark-5 focus:border-primary dark:border-white/15 dark:text-white"
        />
        <Button type="submit" size="md" variant="outline" disabled={!draft.trim() || busy}>
          Add
        </Button>
      </form>
      {titles.length === 0 ? (
        <Empty>Pin titles in Chat or add them to this project, and they&apos;ll collect here.</Empty>
      ) : (
        <ul className="space-y-2">
          {titles.map((t) => (
            <li key={t.entryId} className="group flex items-start gap-3 rounded-lg border border-stroke px-3 py-2.5 dark:border-white/10">
              {t.source === "pinned" ? (
                <Pin className="mt-0.5 size-4 flex-shrink-0 text-accent-blue-text" aria-label="Pinned in Chat" />
              ) : (
                <Type className="mt-0.5 size-4 flex-shrink-0 text-dark-5" aria-hidden />
              )}
              <div className="min-w-0 flex-1">
                <p className="font-roboto text-[15px] font-medium leading-snug text-dark dark:text-white">{t.title}</p>
                <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-dark-5">
                  <span>{t.source === "pinned" ? "Pinned in Chat" : "Saved"}</span>
                  <span>·</span>
                  <span suppressHydrationWarning>{timeAgo(t.createdAt)}</span>
                  {t.thumbnailText && (
                    <span className="brand-accent-chip rounded px-1.5 py-0.5 text-[11px] font-medium">Thumbnail: {t.thumbnailText}</span>
                  )}
                </p>
              </div>
              <div className="flex flex-shrink-0 items-center">
                <IconButton label="Copy title" onClick={() => copy(t.title)}>
                  <Copy className="size-4" />
                </IconButton>
                <Tooltip content="Preview in Studio">
                  <Link
                    href={`/studio?prefillTitle=${encodeURIComponent(t.title)}`}
                    aria-label="Preview in Studio"
                    className="rounded-md p-1.5 text-dark-5 transition hover:bg-gray-100 hover:text-dark dark:hover:bg-white/10 dark:hover:text-white"
                  >
                    <LayoutTemplate className="size-4" />
                  </Link>
                </Tooltip>
                {t.chatId && (
                  <Tooltip content="Open chat">
                    <Link
                      href={`/chat/${t.chatId}`}
                      aria-label="Open chat"
                      className="rounded-md p-1.5 text-dark-5 transition hover:bg-gray-100 hover:text-dark dark:hover:bg-white/10 dark:hover:text-white"
                    >
                      <ExternalLink className="size-4" />
                    </Link>
                  </Tooltip>
                )}
                <IconButton label="Remove from project" danger onClick={() => onRemove(t.entryId)}>
                  <X className="size-4" />
                </IconButton>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

export function VideosSection({ videos, onRemove }: { videos: ProjectVideoEntry[]; onRemove: (entryId: string) => void }) {
  return (
    <Section
      title="Videos"
      icon={Video}
      count={videos.length}
      actions={
        <>
          <Link href="/outliers" className={linkButton}>
            Browse Outliers
          </Link>
          <Link href="/bookmarks" className={linkButton}>
            Bookmarks
          </Link>
        </>
      }
    >
      {videos.length === 0 ? (
        <Empty>Use &ldquo;Add to project&rdquo; on any video in Outliers, Following, Bookmarks or My Channel to collect references here.</Empty>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 2xl:grid-cols-3">
          {videos.map((v) => (
            <VideoCard
              key={v.entryId}
              video={v.video}
              hoverActions={
                <ThumbAction label="Remove from project" onClick={() => onRemove(v.entryId)}>
                  <X className="size-4" />
                </ThumbAction>
              }
            />
          ))}
        </div>
      )}
    </Section>
  );
}

export function StudioSection({
  projectId,
  projectName,
  studio,
  onRemove,
}: {
  projectId: string;
  projectName: string;
  studio: ProjectStudioEntry[];
  onRemove: (entryId: string) => void;
}) {
  return (
    <Section
      title="Studio workspaces"
      icon={LayoutTemplate}
      count={studio.length}
      actions={
        <Link href={`/studio?projectId=${projectId}&projectName=${encodeURIComponent(projectName)}`} className={linkButton}>
          Open Studio
        </Link>
      }
    >
      {studio.length === 0 ? (
        <Empty>Save a Studio workspace to this project to keep thumbnail tests with the rest of the work.</Empty>
      ) : (
        <ul className="divide-y divide-stroke dark:divide-white/10">
          {studio.map((s) => (
            <li key={s.entryId} className="flex items-center gap-3 py-2.5">
              <LayoutTemplate className="size-4 flex-shrink-0 text-dark-5" aria-hidden />
              <Link href={`/studio?workspaceId=${encodeURIComponent(s.workspaceId)}`} className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-dark hover:underline dark:text-white">{s.name}</span>
                {s.updatedAt && (
                  <span className="block text-xs text-dark-5" suppressHydrationWarning>
                    Updated {timeAgo(s.updatedAt)}
                  </span>
                )}
              </Link>
              <IconButton label="Remove from project" onClick={() => onRemove(s.entryId)}>
                <X className="size-4" />
              </IconButton>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

export function NotesSection({
  notes,
  onAdd,
  onUpdate,
  onRemove,
}: {
  notes: ProjectNoteEntry[];
  onAdd: (text: string) => Promise<boolean>;
  onUpdate: (entryId: string, text: string) => Promise<boolean>;
  onRemove: (entryId: string) => void;
}) {
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null);

  const add = async () => {
    setBusy(true);
    if (await onAdd(draft.trim())) setDraft("");
    setBusy(false);
  };
  const saveEdit = async () => {
    if (!editing?.text.trim()) return;
    setBusy(true);
    if (await onUpdate(editing.id, editing.text.trim())) setEditing(null);
    setBusy(false);
  };

  return (
    <Section title="Notes" icon={NotebookPen} count={notes.length}>
      <div className="mb-4 space-y-2">
        <textarea
          rows={3}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Jot down an angle, a hook or a to-do…"
          aria-label="New note"
          className="w-full rounded-lg border border-stroke bg-transparent px-3 py-2 text-sm text-dark outline-none transition placeholder:text-dark-5 focus:border-primary dark:border-white/15 dark:text-white"
        />
        <div className="flex justify-end">
          <Button size="sm" onClick={add} disabled={!draft.trim() || busy}>
            Add note
          </Button>
        </div>
      </div>
      {notes.length === 0 ? (
        <Empty>No notes yet.</Empty>
      ) : (
        <ul className="space-y-2">
          {notes.map((n) =>
            editing?.id === n.entryId ? (
              <li key={n.entryId} className="space-y-2 rounded-lg border border-primary/40 p-3">
                <textarea
                  rows={4}
                  autoFocus
                  value={editing.text}
                  onChange={(e) => setEditing({ id: n.entryId, text: e.target.value })}
                  aria-label="Edit note"
                  className="w-full rounded-lg border border-stroke bg-transparent px-3 py-2 text-sm text-dark outline-none focus:border-primary dark:border-white/15 dark:text-white"
                />
                <div className="flex justify-end gap-2">
                  <Button variant="soft" size="sm" onClick={() => setEditing(null)} disabled={busy}>
                    Cancel
                  </Button>
                  <Button size="sm" onClick={saveEdit} disabled={!editing.text.trim() || busy}>
                    Save
                  </Button>
                </div>
              </li>
            ) : (
              <li key={n.entryId} className="group rounded-lg border border-stroke p-3 dark:border-white/10">
                <p className="whitespace-pre-wrap text-sm text-dark dark:text-white">{n.text}</p>
                <div className="mt-2 flex items-center justify-between">
                  <span className="text-xs text-dark-5" suppressHydrationWarning>
                    {n.updatedAt ? `Edited ${timeAgo(n.updatedAt)}` : timeAgo(n.createdAt)}
                  </span>
                  <span className="flex items-center">
                    <IconButton label="Edit note" onClick={() => setEditing({ id: n.entryId, text: n.text })}>
                      <PenLine className="size-4" />
                    </IconButton>
                    <IconButton label="Delete note" danger onClick={() => onRemove(n.entryId)}>
                      <Trash2 className="size-4" />
                    </IconButton>
                  </span>
                </div>
              </li>
            ),
          )}
        </ul>
      )}
    </Section>
  );
}
