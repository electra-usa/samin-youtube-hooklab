"use client";

import { useState, type FormEvent } from "react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { toast } from "@/components/ui/Toaster";
import { ChannelSelect, type ChannelOption } from "@/components/settings/ChannelSelect";
import { sendJson } from "@/lib/api-client";
import { PROJECTS_UPDATED, emit } from "@/lib/client-events";
import type { ProjectSummary } from "@/lib/projects/types";

const fieldClass =
  "w-full rounded-lg border border-stroke bg-transparent px-4 py-3 text-dark outline-none transition placeholder:text-dark-5 focus:border-primary disabled:opacity-70 dark:border-white/15 dark:text-white dark:focus:border-sky-300";

/** "Create project" (name + description) or "Edit project details" (adds the linked channel). */
export function ProjectFormModal({
  open,
  onClose,
  project,
  channels,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  /** Edit this project; omit to create a new one. */
  project?: ProjectSummary | null;
  channels: ChannelOption[];
  onSaved: (project: ProjectSummary) => void;
}) {
  if (!open) return null;
  // Remount per project so the fields start from its current values.
  return <ProjectForm key={project?.id ?? "new"} onClose={onClose} project={project ?? null} channels={channels} onSaved={onSaved} />;
}

function ProjectForm({
  onClose,
  project,
  channels,
  onSaved,
}: {
  onClose: () => void;
  project: ProjectSummary | null;
  channels: ChannelOption[];
  onSaved: (project: ProjectSummary) => void;
}) {
  const editing = !!project;
  const [name, setName] = useState(project?.name ?? "");
  const [description, setDescription] = useState(project?.description ?? "");
  const [channelId, setChannelId] = useState<string | null>(project?.primaryChannelId ?? null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    try {
      const res = editing
        ? await sendJson<{ project: ProjectSummary }>(`/api/projects/${project.id}`, "PATCH", {
            name,
            description,
            primaryChannelId: channelId,
          })
        : await sendJson<{ project: ProjectSummary }>("/api/projects", "POST", { name, description });
      emit(PROJECTS_UPDATED);
      toast.success(editing ? "Project updated" : "Project created");
      onSaved(res.project);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : editing ? "Couldn't update project" : "Couldn't create project");
      setBusy(false);
    }
  };

  return (
    <Modal open onClose={() => !busy && onClose()} title={editing ? "Edit project details" : "Create project"}>
      <p className="-mt-2 text-sm text-dark-5">
        {editing
          ? "Update the linked channel, name, and description for this project."
          : "Start a shared workspace for related chats, bookmarks, and saved outputs."}
      </p>
      <form onSubmit={submit} className="mt-6 space-y-4">
        {editing && (
          <div>
            <p className="mb-2 block text-sm font-medium text-dark dark:text-white">Project channel</p>
            <ChannelSelect
              ariaLabel="Select project channel"
              channels={channels}
              value={channelId}
              onChange={setChannelId}
              noneLabel="No linked channel"
              placeholder="No linked channel"
              disabled={busy}
            />
          </div>
        )}
        <div>
          <label htmlFor="project-name" className="mb-2 block text-sm font-medium text-dark dark:text-white">
            Project name
          </label>
          <input
            id="project-name"
            value={name}
            autoFocus
            maxLength={120}
            disabled={busy}
            onChange={(e) => setName(e.target.value)}
            placeholder="Your project's name"
            className={fieldClass}
          />
        </div>
        <div>
          <label htmlFor="project-description" className="mb-2 block text-sm font-medium text-dark dark:text-white">
            Description
          </label>
          <textarea
            id="project-description"
            rows={4}
            value={description}
            disabled={busy}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="What is this video about?"
            className={fieldClass}
          />
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="soft" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" disabled={!name.trim() || busy}>
            {editing ? (busy ? "Saving..." : "Save changes") : busy ? "Creating..." : "Create project"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

export function DeleteProjectModal({
  project,
  onClose,
  onDeleted,
}: {
  project: ProjectSummary | null;
  onClose: () => void;
  onDeleted: (id: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  if (!project) return null;

  const confirm = async () => {
    setBusy(true);
    try {
      await sendJson(`/api/projects/${project.id}`, "DELETE");
      emit(PROJECTS_UPDATED);
      toast.success("Project deleted");
      onDeleted(project.id);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't delete project");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      size="sm"
      onClose={() => !busy && onClose()}
      title="Delete project?"
      footer={
        <>
          <Button variant="soft" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="danger" onClick={confirm} disabled={busy}>
            {busy ? "Deleting..." : "Delete project"}
          </Button>
        </>
      }
    >
      <p className="text-sm text-dark-5">
        This will delete &ldquo;{project.name}&rdquo; and remove its saved titles, videos, notes and workspace assignments.
      </p>
      <p className="mt-2 text-sm text-dark-5">Chats will stay in your account, but they will no longer be assigned to the project.</p>
    </Modal>
  );
}
