"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, AlertCircle, Info } from "lucide-react";
import { cn } from "@/lib/format";

type Toast = { id: number; tone: "success" | "error" | "info"; message: string };
const EVENT = "hooklab:toast";
let counter = 0;

export const toast = {
  success: (message: string) => window.dispatchEvent(new CustomEvent(EVENT, { detail: { tone: "success", message } })),
  error: (message: string) => window.dispatchEvent(new CustomEvent(EVENT, { detail: { tone: "error", message } })),
  info: (message: string) => window.dispatchEvent(new CustomEvent(EVENT, { detail: { tone: "info", message } })),
};

export function Toaster() {
  const [toasts, setToasts] = useState<Toast[]>([]);
  useEffect(() => {
    const onToast = (e: Event) => {
      const { tone, message } = (e as CustomEvent).detail as Omit<Toast, "id">;
      const id = ++counter;
      setToasts((t) => [...t, { id, tone, message }]);
      setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3800);
    };
    window.addEventListener(EVENT, onToast);
    return () => window.removeEventListener(EVENT, onToast);
  }, []);

  return (
    <div className="pointer-events-none fixed bottom-5 left-1/2 z-[60] flex -translate-x-1/2 flex-col items-center gap-2">
      {toasts.map((t) => {
        const Icon = t.tone === "success" ? CheckCircle2 : t.tone === "error" ? AlertCircle : Info;
        return (
          <div
            key={t.id}
            className={cn(
              "pointer-events-auto flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm shadow-lg",
              "bg-dark text-white dark:bg-white dark:text-dark",
            )}
          >
            <Icon className={cn("size-4", t.tone === "error" ? "text-red-400" : t.tone === "success" ? "text-green-400" : "text-sky-300")} />
            {t.message}
          </div>
        );
      })}
    </div>
  );
}
