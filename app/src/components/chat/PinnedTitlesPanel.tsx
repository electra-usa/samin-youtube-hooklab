"use client";

import Link from "next/link";
import { ChevronLeft, ChevronRight, MonitorPlay, Pin, X } from "lucide-react";
import { toast } from "@/components/ui/Toaster";
import { cn } from "@/lib/format";
import type { PinnedTitle } from "@/lib/chat/types";
import { copyText } from "./client";

// Right-hand drawer with the chat's pinned titles ("Show pinned titles" tab in the original).
export function PinnedTitlesPanel({
  pins,
  open,
  onOpenChange,
  onUnpin,
}: {
  pins: PinnedTitle[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onUnpin: (id: string) => void;
}) {
  return (
    <>
      {!open && (
        <button
          type="button"
          onClick={() => onOpenChange(true)}
          aria-label="Show pinned titles"
          className="fixed right-0 top-16 z-20 hidden items-center gap-1.5 rounded-l-lg border border-r-0 border-gray-200 bg-[#F8F8F8] px-2.5 py-2.5 text-dark-5 shadow-lg hover:bg-gray-100 lg:flex dark:border-gray-800 dark:bg-[#1b1c1f] dark:hover:bg-gray-800"
        >
          <Pin className="size-4" />
          {pins.length > 0 && <span className="text-xs font-medium text-dark dark:text-white">{pins.length}</span>}
          <ChevronLeft className="size-4" />
        </button>
      )}
      <aside
        aria-label="Pinned titles"
        aria-hidden={!open}
        className={cn(
          "fixed right-0 top-0 z-30 flex h-full w-[320px] flex-col border-l border-stroke bg-white shadow-xl transition-transform duration-200 dark:border-white/10 dark:bg-[#161719]",
          open ? "translate-x-0" : "pointer-events-none translate-x-full",
        )}
      >
        <div className="flex items-center justify-between border-b border-stroke px-4 py-3 dark:border-white/10">
          <div className="flex items-center gap-2 text-sm font-semibold text-dark dark:text-white">
            <Pin className="size-4" /> Pinned titles
          </div>
          <button type="button" onClick={() => onOpenChange(false)} aria-label="Hide pinned titles" className="rounded p-1 text-dark-5 hover:bg-gray-100 dark:hover:bg-white/10">
            <ChevronRight className="size-4" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-3">
          {pins.length === 0 ? (
            <p className="px-1 py-6 text-center text-sm text-dark-5">Pin titles you like with the pin icon and they&apos;ll collect here.</p>
          ) : (
            <ul className="space-y-2">
              {pins.map((p) => (
                <li key={p.id} className="rounded-lg border border-stroke p-2.5 dark:border-white/10">
                  <button
                    type="button"
                    title="Click to copy title"
                    onClick={async () => ((await copyText(p.title)) ? toast.success("Title copied") : toast.error("Couldn't copy"))}
                    className="text-left text-sm leading-snug text-dark hover:text-accent-blue-text dark:text-white"
                  >
                    {p.title}
                  </button>
                  {(p.angle || p.clickTrigger) && (
                    <p className="mt-1 text-[11px] text-dark-5">{[p.angle, p.clickTrigger].filter(Boolean).join(" · ")}</p>
                  )}
                  <div className="mt-2 flex items-center gap-1">
                    <Link
                      href={`/studio?prefillTitle=${encodeURIComponent(p.title)}`}
                      className="inline-flex items-center gap-1 rounded-full border border-stroke px-2 py-0.5 text-[11px] text-dark-5 hover:border-primary hover:text-primary dark:border-white/15"
                    >
                      <MonitorPlay className="size-3" /> Preview in Studio
                    </Link>
                    <button
                      type="button"
                      onClick={() => onUnpin(p.id)}
                      className="ml-auto inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-dark-5 hover:text-red-600"
                    >
                      <X className="size-3" /> Unpin
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </aside>
    </>
  );
}
