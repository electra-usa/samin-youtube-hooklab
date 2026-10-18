"use client";

import { useEffect, useMemo, useState } from "react";
import { Plus, Search, Trash2, X } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { getJson } from "@/lib/api-client";
import { cn } from "@/lib/format";

export type TagSummary = { id: string; name: string; count: number };

export function useUserTags(open: boolean) {
  const [tags, setTags] = useState<TagSummary[] | null>(null);
  useEffect(() => {
    if (!open) return;
    let alive = true;
    getJson<{ tags: TagSummary[] }>("/api/bookmarks/tags")
      .then((r) => alive && setTags(r.tags))
      .catch(() => alive && setTags([]));
    return () => {
      alive = false;
    };
  }, [open]);
  return tags;
}

type AddTagsProps = {
  open: boolean;
  onClose: () => void;
  existingTags: string[];
  onAddTags: (tags: string[]) => void;
  title?: string;
};

/** Pick existing tags or type a new one, then "Done" (original AddTagModal). Mounted fresh on open. */
export function AddTagsModal(props: AddTagsProps) {
  return props.open ? <AddTagsDialog {...props} /> : null;
}

function AddTagsDialog({ open, onClose, existingTags, onAddTags, title = "Add tag" }: AddTagsProps) {
  const tags = useUserTags(open);
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState("");
  const [extra, setExtra] = useState<string[]>([]);

  const names = useMemo(() => {
    const all = [...(tags ?? []).map((t) => t.name), ...extra];
    return [...new Set(all)].filter((n) => n.toLowerCase().includes(query.trim().toLowerCase()));
  }, [tags, extra, query]);

  const toggle = (name: string) => setPicked((p) => (p.includes(name) ? p.filter((x) => x !== name) : [...p, name]));
  const submitDraft = () => {
    const name = draft.trim();
    if (!name) return;
    if (!extra.includes(name) && !(tags ?? []).some((t) => t.name.toLowerCase() === name.toLowerCase())) setExtra((e) => [...e, name]);
    setPicked((p) => (p.includes(name) ? p : [...p, name]));
    setDraft("");
    setCreating(false);
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="sm"
      title={title}
      footer={
        <button
          type="button"
          disabled={!picked.length}
          onClick={() => {
            const fresh = picked.filter((t) => !existingTags.includes(t));
            if (fresh.length) onAddTags(fresh);
            onClose();
          }}
          className={cn(
            "w-full rounded-lg py-2 text-sm font-medium transition",
            picked.length ? "bg-primary text-white hover:bg-primary/90" : "cursor-not-allowed bg-gray-100 text-dark-5 dark:bg-white/10",
          )}
        >
          Done
        </button>
      }
    >
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-dark-5" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Find a tag"
          className="w-full rounded-lg border border-stroke bg-white py-2 pl-9 pr-3 text-sm outline-none focus:border-primary dark:border-white/15 dark:bg-transparent dark:text-white"
        />
      </div>
      <div className="mt-3">
        {creating ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              submitDraft();
            }}
          >
            <input
              autoFocus
              value={draft}
              maxLength={40}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key !== "Escape") return;
                e.stopPropagation();
                setCreating(false);
              }}
              placeholder="Tag name"
              className="w-full rounded-lg border border-stroke bg-white px-3 py-2 text-sm outline-none focus:border-primary dark:border-white/15 dark:bg-transparent dark:text-white"
            />
          </form>
        ) : (
          <button
            type="button"
            onClick={() => setCreating(true)}
            className="flex w-full items-center gap-2 rounded-lg border border-dashed border-stroke px-3 py-2 text-sm text-dark hover:border-primary hover:bg-gray-50 dark:border-white/15 dark:text-white dark:hover:bg-white/5"
          >
            <Plus className="size-4" /> Add tag
          </button>
        )}
      </div>
      <div className="mt-3 max-h-[280px] overflow-y-auto border-t border-stroke pt-3 dark:border-white/10">
        {tags === null ? (
          <p className="py-4 text-center text-sm text-dark-5">Loading tags...</p>
        ) : names.length === 0 ? (
          <p className="py-4 text-center text-sm text-dark-5">{query ? "No tags found" : "No tags yet"}</p>
        ) : (
          <div className="space-y-1">
            {names.map((name) => {
              const already = existingTags.includes(name);
              return (
                <label
                  key={name}
                  className={cn("flex cursor-pointer items-center gap-2 rounded px-2 py-2 hover:bg-gray-100 dark:hover:bg-white/5", already && "opacity-60")}
                >
                  <input
                    type="checkbox"
                    disabled={already}
                    checked={already || picked.includes(name)}
                    onChange={() => toggle(name)}
                    className="size-4 cursor-pointer accent-[#164466]"
                  />
                  <span className="min-w-0 flex-1 truncate text-sm text-dark dark:text-white">{name}</span>
                  {already && <span className="text-xs text-dark-5">Added</span>}
                </label>
              );
            })}
          </div>
        )}
      </div>
    </Modal>
  );
}

type ManageProps = {
  open: boolean;
  onClose: () => void;
  videoTitle: string;
  tags: string[];
  onAddTag: (tag: string) => void;
  onRemoveTag: (tag: string) => void;
  onRemoveBookmark: () => void;
};

/** Tags of one bookmark plus "Remove bookmark" (original ManageBookmarkModal). Mounted fresh on open. */
export function ManageBookmarkModal(props: ManageProps) {
  return props.open ? <ManageBookmarkDialog {...props} /> : null;
}

function ManageBookmarkDialog({ open, onClose, videoTitle, tags, onAddTag, onRemoveTag, onRemoveBookmark }: ManageProps) {
  const userTags = useUserTags(open);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const available = (userTags ?? []).map((t) => t.name).filter((n) => !tags.includes(n));

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="sm"
      title={
        <div>
          <div className="text-base font-semibold">Manage bookmark</div>
          <p className="mt-1 line-clamp-2 text-sm font-normal text-dark-5">{videoTitle}</p>
        </div>
      }
    >
      <div className="-mx-2">
        {adding ? (
          <form
            className="px-2 py-1"
            onSubmit={(e) => {
              e.preventDefault();
              const name = draft.trim();
              if (!name) return;
              if (tags.some((t) => t.toLowerCase() === name.toLowerCase())) return setError("Tag already exists");
              onAddTag(name);
              setDraft("");
              setAdding(false);
            }}
          >
            <input
              autoFocus
              value={draft}
              maxLength={40}
              onChange={(e) => {
                setDraft(e.target.value);
                setError(null);
              }}
              onBlur={() => !draft.trim() && setAdding(false)}
              placeholder="Tag name"
              className="w-full rounded-lg border border-stroke bg-white px-3 py-2 text-sm outline-none focus:border-primary dark:border-white/15 dark:bg-transparent dark:text-white"
            />
            {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
          </form>
        ) : (
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-sm text-dark hover:bg-gray-100 dark:text-white dark:hover:bg-white/5"
          >
            <Plus className="size-4" /> Add tag
          </button>
        )}

        {!adding && available.length > 0 && (
          <div className="mt-1 border-t border-stroke px-2 pt-2 dark:border-white/10">
            <p className="py-1 text-xs font-medium text-dark-5">Your tags</p>
            <div className="max-h-40 overflow-y-auto">
              {available.map((name) => (
                <label key={name} className="flex cursor-pointer items-center gap-2 rounded px-1 py-1.5 hover:bg-gray-100 dark:hover:bg-white/5">
                  <input type="checkbox" checked={false} onChange={() => onAddTag(name)} className="size-4 cursor-pointer accent-[#164466]" />
                  <span className="min-w-0 flex-1 truncate text-sm text-dark dark:text-white">{name}</span>
                </label>
              ))}
            </div>
          </div>
        )}

        {tags.length > 0 && (
          <div className="mt-1 border-t border-stroke px-2 pt-2 dark:border-white/10">
            <p className="py-1 text-xs font-medium text-dark-5">Current tags</p>
            {tags.map((name) => (
              <div key={name} className="group flex items-center justify-between rounded px-1 py-1 hover:bg-gray-100 dark:hover:bg-white/5">
                <span className="text-sm text-dark dark:text-white">{name}</span>
                <button
                  type="button"
                  onClick={() => onRemoveTag(name)}
                  aria-label={`Remove ${name} tag`}
                  className="rounded p-0.5 text-dark-5 opacity-60 transition hover:text-red-600 group-hover:opacity-100"
                >
                  <X className="size-4" />
                </button>
              </div>
            ))}
          </div>
        )}

        <div className="mt-1 border-t border-stroke pt-1 dark:border-white/10">
          <button
            type="button"
            onClick={onRemoveBookmark}
            className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-sm text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-500/10"
          >
            <Trash2 className="size-4" /> Remove bookmark
          </button>
        </div>
      </div>
    </Modal>
  );
}
