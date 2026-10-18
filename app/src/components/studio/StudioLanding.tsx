"use client";

import { useRef, useState } from "react";
import { Plus } from "lucide-react";
import { cn } from "@/lib/format";
import { IMAGE_ACCEPT, prepareImageFiles } from "./uploads";

/** First Studio screen: drop a thumbnail or type a title to start a workspace. */
export function StudioLanding({ onAddTitle, onAddFiles }: { onAddTitle: (title: string) => void; onAddFiles: (files: File[]) => void }) {
  const [title, setTitle] = useState("");
  const [dragging, setDragging] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const addFiles = async (list: FileList | File[]) => {
    const files = await prepareImageFiles(list);
    if (files.length) onAddFiles(files);
  };
  const submit = () => {
    const t = title.trim();
    if (!t) return;
    onAddTitle(t);
    setTitle("");
  };

  return (
    <div
      className={cn(
        "relative flex min-h-[calc(100vh-8rem)] flex-col items-center justify-center gap-8 px-4 py-12 transition-colors",
        dragging && "rounded-xl border-2 border-dashed border-primary bg-primary/10 ring-2 ring-primary ring-offset-2",
      )}
      onDragOver={(e) => {
        e.preventDefault();
        if (e.dataTransfer.types.includes("Files")) {
          e.dataTransfer.dropEffect = "copy";
          setDragging(true);
        }
      }}
      onDragLeave={(e) => {
        if (e.currentTarget.contains(e.relatedTarget as Node)) return;
        setDragging(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        if (e.dataTransfer.files?.length) void addFiles(e.dataTransfer.files);
      }}
    >
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
      <div className="flex w-full max-w-lg flex-col items-center gap-6">
        <h2 className="text-center text-xl font-semibold text-dark dark:text-white">Preview your title and thumbnail on YouTube</h2>
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          aria-label="Add thumbnail - drop image or click to select"
          style={{ aspectRatio: "16 / 9", minHeight: 180 }}
          className={cn(
            "flex w-full cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed p-12 transition-colors",
            "border-stroke bg-white/50 hover:border-primary hover:bg-primary/5 dark:border-white/15 dark:bg-white/5 dark:hover:border-sky-300",
            dragging && "border-primary bg-primary/10",
          )}
        >
          <Plus className={cn("size-10 stroke-[1.5] transition-colors", dragging ? "text-primary" : "text-[var(--color-muted)]")} aria-hidden />
          <span className={cn("mt-3 text-base font-medium", dragging ? "text-primary" : "text-dark dark:text-white")}>
            {dragging ? "Drop image anywhere" : "Drop thumbnail image here"}
          </span>
          {!dragging && <span className="mt-1 text-sm text-[var(--color-muted)]">(or click to select a file)</span>}
        </button>
        <div className="flex w-full flex-col gap-2">
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                submit();
              }
            }}
            placeholder="Enter your title to see how it looks on YouTube"
            aria-label="Enter video title"
            className="w-full rounded-lg border border-stroke bg-white px-4 py-3 text-base text-dark placeholder:text-dark-5 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary dark:border-white/15 dark:bg-white/5 dark:text-white dark:placeholder:text-gray-500"
          />
          <button
            type="button"
            onClick={submit}
            disabled={!title.trim()}
            className="inline-flex w-full items-center justify-center rounded-lg bg-primary px-4 py-3 text-base font-medium text-white transition hover:bg-primary-hover disabled:pointer-events-none disabled:opacity-50"
          >
            Continue
          </button>
        </div>
      </div>
    </div>
  );
}
