"use client";

import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { Plus, SquarePen, Trash2 } from "lucide-react";
import { cn } from "@/lib/format";
import { IMAGE_ACCEPT, prepareImageFiles } from "./uploads";

const SELECTED = "rounded-md border border-primary bg-primary/5 shadow-sm dark:border-sky-300/70 dark:bg-sky-300/10";
const IDLE = "rounded-md border border-stroke bg-white dark:border-white/10 dark:bg-white/5";
const ICON_BTN =
  "shrink-0 rounded p-1 text-dark-5 opacity-0 transition-opacity hover:bg-gray-200 hover:text-dark group-hover:opacity-100 focus-visible:opacity-100 dark:text-gray-400 dark:hover:bg-white/10 dark:hover:text-white";

function Section({ title, onAdd, children }: { title: string; onAdd?: () => void; children: ReactNode }) {
  return (
    <section className="space-y-2">
      <h3 className="text-sm font-medium text-dark dark:text-white">{title}</h3>
      {children}
      {onAdd && (
        <button
          type="button"
          onClick={onAdd}
          aria-label={`Add ${title}`}
          className="flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-primary hover:bg-gray-200 dark:text-white dark:hover:bg-white/10"
        >
          <Plus className="size-3.5" aria-hidden />
        </button>
      )}
    </section>
  );
}

/**
 * A selectable, editable line (title or thumbnail text). Clicking a filled item
 * toggles whether it's in the preview; the pencil edits it.
 */
function TextItem({
  value,
  index,
  kind,
  selected,
  onToggle,
  onChange,
  onRemove,
}: {
  value: string;
  index: number;
  kind: "title" | "thumbnail text";
  selected: boolean;
  onToggle: () => void;
  onChange: (v: string) => void;
  onRemove: (() => void) | null;
}) {
  const ref = useRef<HTMLInputElement & HTMLTextAreaElement>(null);
  const [editing, setEditing] = useState(false);
  const filled = value.trim() !== "";
  const multiline = kind === "thumbnail text";

  useLayoutEffect(() => {
    const el = ref.current;
    if (!multiline || !el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [value, multiline]);

  const shared = {
    ref,
    value,
    placeholder: multiline ? "Thumbnail text" : "Title",
    readOnly: filled && !editing,
    "aria-label": multiline ? `Thumbnail text ${index + 1}` : `Title ${index + 1}`,
    onChange: (e: { target: { value: string } }) => onChange(e.target.value),
    onClick: (e: { stopPropagation: () => void }) => editing && e.stopPropagation(),
    onMouseDown: (e: { preventDefault: () => void }) => {
      if (filled && !editing) e.preventDefault();
    },
    onFocus: () => {
      setEditing(true);
      if (filled && !selected) onToggle();
    },
    onBlur: () => setEditing(false),
    className: cn(
      "min-w-0 flex-1 rounded-md border-0 bg-transparent px-2.5 py-1.5 text-sm text-dark outline-none placeholder:text-dark-5 focus:ring-2 focus:ring-primary dark:text-white dark:placeholder:text-gray-500",
      multiline && "min-h-[2.5rem] resize-none overflow-hidden",
      filled && !editing ? "cursor-pointer" : "cursor-text",
    ),
  };

  return (
    <div
      onClick={() => (filled ? onToggle() : ref.current?.focus())}
      className={cn("group flex cursor-pointer items-center gap-1 p-1 transition-colors", selected && filled ? SELECTED : IDLE)}
    >
      {multiline ? (
        <textarea
          {...shared}
          rows={1}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              e.currentTarget.blur();
            }
          }}
        />
      ) : (
        <input
          {...shared}
          type="text"
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              e.currentTarget.blur();
            }
          }}
        />
      )}
      {filled && (
        <button
          type="button"
          aria-label={`Edit ${kind} ${index + 1}`}
          onClick={(e) => {
            e.stopPropagation();
            setEditing(true);
            setTimeout(() => ref.current?.focus(), 0);
          }}
          className={ICON_BTN}
        >
          <SquarePen className="size-4" aria-hidden />
        </button>
      )}
      {onRemove && (
        <button
          type="button"
          aria-label={`Remove ${kind} ${index + 1}`}
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
          className={ICON_BTN}
        >
          <Trash2 className="size-4" aria-hidden />
        </button>
      )}
    </div>
  );
}

export function WorkspaceSidebar({
  titles,
  thumbnailTexts,
  thumbnails,
  selectedTitles,
  selectedTexts,
  selectedThumbnails,
  onTitlesChange,
  onTextsChange,
  onAddFiles,
  onToggleTitle,
  onToggleText,
  onToggleThumbnail,
  onRemoveTitle,
  onRemoveText,
  onRemoveThumbnail,
}: {
  titles: string[];
  thumbnailTexts: string[];
  thumbnails: string[];
  selectedTitles: number[];
  selectedTexts: number[];
  selectedThumbnails: number[];
  onTitlesChange: (titles: string[]) => void;
  onTextsChange: (texts: string[]) => void;
  onAddFiles: (files: File[]) => void;
  onToggleTitle: (i: number) => void;
  onToggleText: (i: number) => void;
  onToggleThumbnail: (i: number) => void;
  onRemoveTitle: (i: number) => void;
  onRemoveText: (i: number) => void;
  onRemoveThumbnail: (i: number) => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const addFiles = async (list: FileList | File[]) => {
    const files = await prepareImageFiles(list);
    if (files.length) onAddFiles(files);
  };
  const titleRows = titles.length ? titles : [""];

  return (
    <aside className="flex w-full flex-col gap-6 overflow-y-auto rounded-xl border border-stroke bg-[#F8F8F8] p-4 dark:border-white/10 dark:bg-[#18191c] lg:w-[280px] lg:min-w-[280px] lg:max-w-[280px]">
      <Section title="Titles" onAdd={() => onTitlesChange([...titles, ""])}>
        <ul className="space-y-2">
          {titleRows.map((t, i) => (
            <li key={i}>
              <TextItem
                kind="title"
                value={t}
                index={i}
                selected={selectedTitles.includes(i)}
                onToggle={() => onToggleTitle(i)}
                onChange={(v) => {
                  const next = titles.length ? [...titles] : [""];
                  next[i] = v;
                  onTitlesChange(next);
                }}
                onRemove={t.trim() || titles.length > 1 ? () => onRemoveTitle(i) : null}
              />
            </li>
          ))}
        </ul>
      </Section>

      <Section title="Thumbnail text" onAdd={() => onTextsChange([...thumbnailTexts, ""])}>
        <ul className="space-y-2">
          {thumbnailTexts.map((t, i) => (
            <li key={i}>
              <TextItem
                kind="thumbnail text"
                value={t}
                index={i}
                selected={selectedTexts.includes(i)}
                onToggle={() => onToggleText(i)}
                onChange={(v) => {
                  const next = [...thumbnailTexts];
                  next[i] = v;
                  onTextsChange(next);
                }}
                onRemove={t.trim() || thumbnailTexts.length > 1 ? () => onRemoveText(i) : null}
              />
            </li>
          ))}
        </ul>
      </Section>

      <Section title="Thumbnails">
        <input
          ref={fileRef}
          type="file"
          accept={IMAGE_ACCEPT}
          multiple
          className="sr-only"
          aria-hidden
          tabIndex={-1}
          onChange={(e) => {
            if (e.target.files?.length) void addFiles(e.target.files);
            e.target.value = "";
          }}
        />
        <ul className="space-y-2">
          {thumbnails.map((src, i) => {
            const on = selectedThumbnails.includes(i);
            const uploading = src.startsWith("blob:");
            return (
              <li key={`${src}-${i}`}>
                <div onClick={() => onToggleThumbnail(i)} className={cn("group relative cursor-pointer overflow-hidden p-1 transition-colors", on ? SELECTED : IDLE)}>
                  <div className="relative aspect-video w-full overflow-hidden rounded-md">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={src} alt={`Thumbnail ${i + 1}`} draggable={false} className={cn("h-full w-full object-cover", uploading && "opacity-60")} />
                    {uploading && (
                      <span className="absolute inset-0 flex items-center justify-center">
                        <span className="size-6 animate-spin rounded-full border-2 border-white border-t-transparent" />
                      </span>
                    )}
                  </div>
                  <button
                    type="button"
                    aria-label={`Remove thumbnail ${i + 1}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      onRemoveThumbnail(i);
                    }}
                    className="absolute right-2 top-2 rounded bg-black/50 p-1 text-white opacity-0 transition-opacity hover:bg-black/70 group-hover:opacity-100 focus-visible:opacity-100"
                  >
                    <Trash2 className="size-4" aria-hidden />
                  </button>
                </div>
              </li>
            );
          })}
          <li>
            <button
              type="button"
              aria-label="Add thumbnail"
              onClick={() => fileRef.current?.click()}
              onDragOver={(e) => {
                e.preventDefault();
                if (e.dataTransfer.types.includes("Files")) {
                  e.dataTransfer.dropEffect = "copy";
                  setDragOver(true);
                }
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragOver(false);
                if (e.dataTransfer.files?.length) void addFiles(e.dataTransfer.files);
              }}
              style={{ aspectRatio: "16 / 9" }}
              className={cn(
                "flex w-full cursor-pointer flex-col items-center justify-center rounded-md border-2 border-dashed border-stroke bg-white/50 p-1 transition-colors hover:border-primary hover:bg-primary/5 dark:border-white/15 dark:bg-white/5 dark:hover:border-sky-300",
                dragOver && "border-primary bg-primary/10 ring-2 ring-primary ring-offset-2",
              )}
            >
              <Plus className={cn("size-8 transition-colors", dragOver ? "text-primary" : "text-dark-5 dark:text-gray-400")} aria-hidden />
              <span className={cn("mt-1 text-xs font-medium", dragOver ? "text-primary" : "text-[var(--color-muted)]")}>
                {dragOver ? "Drop image" : "Add thumbnail"}
              </span>
            </button>
          </li>
        </ul>
      </Section>
    </aside>
  );
}
