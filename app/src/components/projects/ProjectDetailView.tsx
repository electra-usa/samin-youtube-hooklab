"use client";

import { useCallback, useEffect, useState, type KeyboardEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, MoreHorizontal, Pencil, Trash2 } from "lucide-react";
import { MenuItem, Popover } from "@/components/ui/Popover";
import { toast } from "@/components/ui/Toaster";
import { ChannelAvatar, type ChannelOption } from "@/components/settings/ChannelSelect";
import { getJson, sendJson } from "@/lib/api-client";
import { PROJECTS_UPDATED, emit } from "@/lib/client-events";
import { timeAgo } from "@/lib/format";
import type { ProjectStatus } from "@/lib/projects/status";
import type { ProjectDetail, ProjectSummary } from "@/lib/projects/types";
import { ChatPickerModal } from "./ChatPickerModal";
import { DeleteProjectModal, ProjectFormModal } from "./ProjectModals";
import { ProjectStatusMenu } from "./ProjectStatusMenu";
import { ChatsSection, NotesSection, StudioSection, TitlesSection, VideosSection } from "./ProjectSections";

const message = (err: unknown, fallback: string) => (err instanceof Error && err.message ? err.message : fallback);

export function ProjectDetailView({ initial, channels }: { initial: ProjectDetail; channels: ChannelOption[] }) {
  const router = useRouter();
  const [detail, setDetail] = useState(initial);
  const [editOpen, setEditOpen] = useState(false);
  const [deleting, setDeleting] = useState<ProjectSummary | null>(null);
  const [chatPickerOpen, setChatPickerOpen] = useState(false);
  const { project } = detail;
  const id = project.id;

  const reload = useCallback(async () => {
    try {
      setDetail(await getJson<ProjectDetail>(`/api/projects/${id}`));
    } catch {
      // Keep what's on screen; the next action will try again.
    }
  }, [id]);

  // Refresh on arrival (back/forward can replay an older server render) and on project changes.
  useEffect(() => {
    const onUpdate = () => void reload();
    onUpdate();
    window.addEventListener(PROJECTS_UPDATED, onUpdate);
    return () => window.removeEventListener(PROJECTS_UPDATED, onUpdate);
  }, [reload]);

  const patchProject = async (patch: Partial<{ name: string; description: string | null; status: ProjectStatus }>) => {
    try {
      const res = await sendJson<{ project: ProjectSummary }>(`/api/projects/${id}`, "PATCH", patch);
      setDetail((d) => ({ ...d, project: res.project }));
      emit(PROJECTS_UPDATED);
      return true;
    } catch (err) {
      toast.error(message(err, "Couldn't update the project"));
      return false;
    }
  };

  const addItem = async (body: { kind: string; refId?: string; payload?: unknown }, success: string) => {
    try {
      const res = await sendJson<{ created: boolean }>(`/api/projects/${id}/items`, "POST", body);
      toast.success(res.created ? success : "Already in this project");
      emit(PROJECTS_UPDATED);
      return true;
    } catch (err) {
      toast.error(message(err, "Couldn't add it to the project"));
      return false;
    }
  };

  const updateItem = async (entryId: string, payload: unknown) => {
    try {
      await sendJson(`/api/projects/${id}/items/${encodeURIComponent(entryId)}`, "PATCH", { payload });
      emit(PROJECTS_UPDATED);
      return true;
    } catch (err) {
      toast.error(message(err, "Couldn't save the change"));
      return false;
    }
  };

  const removeEntry = async (entryId: string) => {
    try {
      await sendJson(`/api/projects/${id}/items/${encodeURIComponent(entryId)}`, "DELETE");
      toast.success("Removed from project");
      emit(PROJECTS_UPDATED);
    } catch (err) {
      toast.error(message(err, "Couldn't remove it"));
    }
  };

  return (
    <div className="mx-auto w-full max-w-[1248px] px-6 pb-16 pt-6">
      <Link href="/projects" className="mb-4 inline-flex items-center gap-1.5 text-sm text-dark-5 transition hover:text-dark dark:hover:text-white">
        <ArrowLeft className="size-4" /> Projects
      </Link>

      <header className="mb-6">
        <div className="flex items-start gap-4">
          <ChannelAvatar name={project.primaryChannelName ?? project.name} avatar={project.primaryChannelAvatar} size={48} />
          <div className="min-w-0 flex-1">
            <InlineName key={`name-${project.name}`} value={project.name} onSave={(name) => patchProject({ name })} />
            <InlineDescription
              key={`desc-${project.description ?? ""}`}
              value={project.description ?? ""}
              onSave={(description) => patchProject({ description: description || null })}
            />
            <p className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-dark-5">
              {project.primaryChannelName && <span>{project.primaryChannelName}</span>}
              {project.primaryChannelName && <span aria-hidden>·</span>}
              <span>
                {project.itemCount} {project.itemCount === 1 ? "item" : "items"}
              </span>
              <span aria-hidden>·</span>
              <span suppressHydrationWarning>Updated {timeAgo(project.updatedAt)}</span>
            </p>
          </div>
          <div className="flex flex-shrink-0 items-center gap-2 pt-1">
            <ProjectStatusMenu status={project.status} align="right" onChange={(status) => patchProject({ status })} />
            <Popover
              align="right"
              panelClassName="w-48 min-w-0"
              trigger={({ toggle, open }) => (
                <button
                  type="button"
                  onClick={toggle}
                  aria-haspopup="menu"
                  aria-expanded={open}
                  aria-label="Project actions"
                  className="flex size-9 items-center justify-center rounded-lg border border-stroke text-dark-5 transition hover:bg-gray-100 hover:text-dark dark:border-white/15 dark:hover:bg-white/10 dark:hover:text-white"
                >
                  <MoreHorizontal className="size-4" />
                </button>
              )}
            >
              {(close) => (
                <div role="menu">
                  <MenuItem
                    icon={<Pencil className="size-4" />}
                    onClick={() => {
                      close();
                      setEditOpen(true);
                    }}
                  >
                    Edit details
                  </MenuItem>
                  <MenuItem
                    danger
                    icon={<Trash2 className="size-4" />}
                    onClick={() => {
                      close();
                      setDeleting(project);
                    }}
                  >
                    Delete project
                  </MenuItem>
                </div>
              )}
            </Popover>
          </div>
        </div>
      </header>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="min-w-0 space-y-6">
          <ChatsSection projectId={id} chats={detail.chats} onAddExisting={() => setChatPickerOpen(true)} onRemove={removeEntry} />
          <TitlesSection
            titles={detail.titles}
            onAdd={(title) => addItem({ kind: "title", payload: { title } }, "Title saved")}
            onRemove={removeEntry}
          />
          <VideosSection videos={detail.videos} onRemove={removeEntry} />
        </div>
        <div className="min-w-0 space-y-6">
          <NotesSection
            notes={detail.notes}
            onAdd={(text) => addItem({ kind: "note", payload: { text } }, "Note added")}
            onUpdate={(entryId, text) => updateItem(entryId, { text })}
            onRemove={removeEntry}
          />
          <StudioSection projectId={id} projectName={project.name} studio={detail.studio} onRemove={removeEntry} />
        </div>
      </div>

      <ProjectFormModal
        open={editOpen}
        project={project}
        channels={channels}
        onClose={() => setEditOpen(false)}
        onSaved={(updated) => {
          setEditOpen(false);
          setDetail((d) => ({ ...d, project: updated }));
        }}
      />
      <DeleteProjectModal
        project={deleting}
        onClose={() => setDeleting(null)}
        onDeleted={() => {
          setDeleting(null);
          router.push("/projects");
        }}
      />
      <ChatPickerModal
        open={chatPickerOpen}
        projectId={id}
        onClose={() => setChatPickerOpen(false)}
        onPick={async (chatId) => {
          if (await addItem({ kind: "chat", refId: chatId }, "Chat added to project")) setChatPickerOpen(false);
        }}
      />
    </div>
  );
}

/** Project name that edits in place; Enter or leaving the field saves, Escape cancels. */
function InlineName({ value, onSave }: { value: string; onSave: (name: string) => Promise<boolean> }) {
  const [draft, setDraft] = useState(value);
  const commit = async () => {
    const next = draft.trim().replace(/\s+/g, " ");
    if (!next) return setDraft(value);
    if (next !== value && !(await onSave(next))) setDraft(value);
  };
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") e.currentTarget.blur();
    if (e.key === "Escape") {
      setDraft(value);
      requestAnimationFrame(() => (e.target as HTMLInputElement).blur());
    }
  };
  return (
    <input
      value={draft}
      maxLength={120}
      aria-label="Project name"
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={onKeyDown}
      className="-ml-2 w-full rounded-lg border border-transparent bg-transparent px-2 py-0.5 text-[26px] font-bold leading-tight text-dark outline-none transition hover:border-stroke focus:border-primary dark:text-white dark:hover:border-white/15"
    />
  );
}

function InlineDescription({ value, onSave }: { value: string; onSave: (description: string) => Promise<boolean> }) {
  const [draft, setDraft] = useState(value);
  const commit = async () => {
    const next = draft.trim();
    if (next !== value.trim() && !(await onSave(next))) setDraft(value);
  };
  return (
    <textarea
      value={draft}
      rows={Math.min(6, Math.max(1, draft.split("\n").length))}
      maxLength={4000}
      aria-label="Project description"
      placeholder="Add a description: what is this video about?"
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) e.currentTarget.blur();
        if (e.key === "Escape") setDraft(value);
      }}
      className="-ml-2 mt-1 w-full resize-none rounded-lg border border-transparent bg-transparent px-2 py-1 text-sm text-dark-5 outline-none transition placeholder:text-dark-5/70 hover:border-stroke focus:border-primary focus:text-dark dark:hover:border-white/15 dark:focus:text-white"
    />
  );
}
