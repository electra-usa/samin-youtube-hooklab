"use client";

import { useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { toast } from "@/components/ui/Toaster";
import { sendJson } from "@/lib/api-client";
import { cn } from "@/lib/format";

/** "Create New Tag" (original NewTagModal). */
export function NewTagModal({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: () => void }) {
  if (!open) return null;
  return <NewTagDialog onClose={onClose} onCreated={onCreated} />;
}

function NewTagDialog({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const create = async () => {
    const clean = name.trim();
    if (!clean || busy) return;
    setBusy(true);
    try {
      await sendJson("/api/bookmarks/tags", "POST", { name: clean });
      toast.success(`Tag "${clean}" created`);
      onCreated();
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to create tag");
      setBusy(false);
    }
  };
  return (
    <Modal
      open
      onClose={onClose}
      title="Create New Tag"
      size="sm"
      footer={
        <>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="rounded-lg border border-stroke px-4 py-2 text-sm font-medium text-dark transition hover:bg-gray-100 dark:border-white/15 dark:text-white dark:hover:bg-white/10"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void create()}
            disabled={!name.trim() || busy}
            className={cn(
              "rounded-lg px-4 py-2 text-sm font-medium text-white transition",
              !name.trim() || busy ? "cursor-not-allowed bg-gray-300 dark:bg-white/10" : "bg-primary hover:bg-primary/90",
            )}
          >
            {busy ? "Creating..." : "Create Tag"}
          </button>
        </>
      }
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void create();
        }}
      >
        <label htmlFor="tag-name" className="mb-2 block text-sm font-medium text-dark dark:text-white">
          Tag name
        </label>
        <input
          id="tag-name"
          autoFocus
          maxLength={40}
          value={name}
          onChange={(e) => setName(e.target.value)}
          disabled={busy}
          placeholder="e.g., Tutorial, Review, Inspiration"
          className="w-full rounded-lg border border-stroke bg-white px-4 py-2.5 text-sm text-dark outline-none focus:border-primary dark:border-white/15 dark:bg-transparent dark:text-white"
        />
        <p className="mt-1.5 text-xs text-dark-5">This tag will be available when tagging your bookmarks</p>
      </form>
    </Modal>
  );
}

/** "Manage Tag": rename on blur / Enter, or delete it from every bookmark. */
export function ManageTagModal({ tag, onClose, onUpdated }: { tag: { id: string; name: string } | null; onClose: () => void; onUpdated: () => void }) {
  if (!tag) return null;
  return <ManageTagDialog key={tag.id} tag={tag} onClose={onClose} onUpdated={onUpdated} />;
}

function ManageTagDialog({ tag, onClose, onUpdated }: { tag: { id: string; name: string }; onClose: () => void; onUpdated: () => void }) {
  const [name, setName] = useState(tag.name);
  const [current, setCurrent] = useState(tag.name);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const rename = async () => {
    const clean = name.trim();
    if (!clean || clean === current) return;
    setSaving(true);
    try {
      await sendJson(`/api/bookmarks/tags/${tag.id}`, "PATCH", { name: clean });
      setCurrent(clean);
      toast.success("Tag renamed");
      onUpdated();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to rename tag");
      setName(current);
    } finally {
      setSaving(false);
    }
  };
  const remove = async () => {
    if (!window.confirm(`Delete tag "${current}"? This will remove it from all bookmarks.`)) return;
    setDeleting(true);
    try {
      await sendJson(`/api/bookmarks/tags/${tag.id}`, "DELETE");
      toast.success(`Deleted tag "${current}"`);
      onUpdated();
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to delete tag");
      setDeleting(false);
    }
  };
  return (
    <Modal
      open
      onClose={onClose}
      title="Manage Tag"
      size="sm"
      footer={
        <div className="flex w-full items-center justify-between">
          <button type="button" onClick={() => void remove()} disabled={deleting} className="text-sm font-medium text-red-600 transition hover:text-red-700 disabled:opacity-50 dark:text-red-400">
            {deleting ? "Deleting..." : "Delete tag"}
          </button>
          <button type="button" onClick={onClose} className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white transition hover:bg-primary/90">
            Done
          </button>
        </div>
      }
    >
      <label className="mb-2 block text-sm font-medium text-dark dark:text-white">Tag name</label>
      <div className="flex items-center gap-2">
        <input
          value={name}
          maxLength={40}
          onChange={(e) => setName(e.target.value)}
          onBlur={() => void rename()}
          onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
          placeholder="Tag name"
          className="flex-1 rounded-lg border border-stroke bg-white px-3 py-2 text-sm text-dark outline-none focus:ring-2 focus:ring-primary dark:border-white/15 dark:bg-transparent dark:text-white"
        />
        {saving && <span className="text-xs text-dark-5">Saving...</span>}
      </div>
    </Modal>
  );
}
