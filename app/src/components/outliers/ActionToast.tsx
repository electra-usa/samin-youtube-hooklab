"use client";

import { useEffect, useState, type ReactNode } from "react";
import { CheckCircle2 } from "lucide-react";

// Toasts with an inline action ("Hidden X · Undo", "Video bookmarked · Add tag",
// "Following X · Add to a list"). Plain messages use the shared Toaster; these need
// a button, so research pages mount their own small stack just above it.

type ActionToastItem = { id: number; message: ReactNode; actionLabel: string; onAction: () => void; duration: number };
const EVENT = "hooklab:action-toast";
let seq = 0;

export function actionToast(message: ReactNode, actionLabel: string, onAction: () => void, duration = 8000) {
  window.dispatchEvent(new CustomEvent(EVENT, { detail: { id: ++seq, message, actionLabel, onAction, duration } }));
}

export function ActionToaster() {
  const [items, setItems] = useState<ActionToastItem[]>([]);
  useEffect(() => {
    const onToast = (e: Event) => {
      const item = (e as CustomEvent<ActionToastItem>).detail;
      setItems((list) => [...list.slice(-2), item]);
      setTimeout(() => setItems((list) => list.filter((x) => x.id !== item.id)), item.duration);
    };
    window.addEventListener(EVENT, onToast);
    return () => window.removeEventListener(EVENT, onToast);
  }, []);
  if (!items.length) return null;
  return (
    <div className="pointer-events-none fixed bottom-16 left-1/2 z-[60] flex -translate-x-1/2 flex-col items-center gap-2">
      {items.map((t) => (
        <div key={t.id} role="status" className="pointer-events-auto flex items-center gap-3 rounded-xl bg-dark px-4 py-2.5 text-sm text-white shadow-lg dark:bg-white dark:text-dark">
          <CheckCircle2 className="size-4 text-green-400" />
          <span>{t.message}</span>
          <button
            type="button"
            onClick={() => {
              setItems((list) => list.filter((x) => x.id !== t.id));
              t.onAction();
            }}
            className="rounded bg-primary px-2 py-1 text-xs font-medium text-white hover:bg-primary/90 dark:bg-sky-700"
          >
            {t.actionLabel}
          </button>
        </div>
      ))}
    </div>
  );
}
