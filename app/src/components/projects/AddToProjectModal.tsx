"use client";

import { useEffect, useState } from "react";
import { Folder, Plus } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { toast } from "@/components/ui/Toaster";
import { getJson, sendJson } from "@/lib/api-client";
import { PROJECTS_UPDATED, emit } from "@/lib/client-events";
import { cn } from "@/lib/format";

/** Anything that can be filed into a project (original: "Add to project" on chats, Studio, titles, videos). */
export type ProjectItemInput = {
  kind: "chat" | "bookmark" | "video" | "title" | "studio" | "note";
  refId?: string;
  payload?: unknown;
  /** Shown in the dialog, e.g. the chat or video title. */
  label: string;
};

type ProjectSummary = { id: string; name: string; status: string; updatedAt: string; itemCount: number };

// API contract (implemented under src/app/api/projects):
//   GET  /api/projects                 -> { projects: ProjectSummary[] }
//   POST /api/projects                 { name, description? } -> { project: ProjectSummary }
//   POST /api/projects/[id]/items      { kind, refId?, payload? } -> { item }
export function AddToProjectModal(props: {
  open: boolean;
  onClose: () => void;
  item: ProjectItemInput;
  onAdded?: (projectId: string) => void;
}) {
  // Mount the dialog body only while open so every opening starts from a clean selection.
  return props.open ? <AddToProjectDialog {...props} /> : null;
}

function AddToProjectDialog({
  open,
  onClose,
  item,
  onAdded,
}: {
  open: boolean;
  onClose: () => void;
  item: ProjectItemInput;
  onAdded?: (projectId: string) => void;
}) {
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    getJson<{ projects: ProjectSummary[] }>("/api/projects")
      .then((r) => setProjects(r.projects))
      .catch(() => setProjects([]));
  }, []);

  const save = async () => {
    setBusy(true);
    try {
      let projectId = selected;
      if (!projectId && newName.trim()) {
        const created = await sendJson<{ project: ProjectSummary }>("/api/projects", "POST", { name: newName.trim() });
        projectId = created.project.id;
      }
      if (!projectId) return;
      await sendJson(`/api/projects/${projectId}/items`, "POST", { kind: item.kind, refId: item.refId, payload: item.payload });
      emit(PROJECTS_UPDATED);
      toast.success("Added to project");
      onAdded?.(projectId);
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't add to project");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Add to project"
      footer={
        <>
          <Button variant="soft" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={save} disabled={busy || (!selected && !newName.trim())}>
            {busy ? "Saving…" : "Add"}
          </Button>
        </>
      }
    >
      <p className="mb-3 line-clamp-2 text-sm text-dark-5">{item.label}</p>
      <div className="max-h-64 space-y-1 overflow-y-auto">
        {projects === null && <p className="text-sm text-dark-5">Loading projects…</p>}
        {projects?.length === 0 && <p className="text-sm text-dark-5">No projects yet. Create one below.</p>}
        {projects?.map((p) => (
          <button
            key={p.id}
            type="button"
            onClick={() => {
              setSelected(p.id);
              setNewName("");
            }}
            className={cn(
              "flex w-full items-center gap-3 rounded-lg border px-3 py-2.5 text-left text-sm transition-colors",
              selected === p.id ? "border-primary bg-primary/5" : "border-stroke hover:bg-gray-50 dark:border-white/10 dark:hover:bg-white/5",
            )}
          >
            <Folder className="size-4 text-dark-5" />
            <span className="flex-1 truncate font-medium">{p.name}</span>
            <span className="text-xs text-dark-5">{p.itemCount} items</span>
          </button>
        ))}
      </div>
      <div className="mt-4 flex items-center gap-2">
        <Plus className="size-4 text-dark-5" />
        <input
          value={newName}
          onChange={(e) => {
            setNewName(e.target.value);
            if (e.target.value) setSelected(null);
          }}
          placeholder="Or create a new project"
          className="h-10 flex-1 rounded-lg border border-stroke px-3 text-sm outline-none focus:border-primary dark:border-white/15 dark:bg-transparent"
        />
      </div>
    </Modal>
  );
}
