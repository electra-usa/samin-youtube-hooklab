"use client";

import { useRef, useState, type ReactNode } from "react";
import { cn } from "@/lib/format";

// Hover tooltip with the original's dark translucent bubble and arrow.
export function Tooltip({
  content,
  children,
  side = "top",
  className,
}: {
  content: ReactNode;
  children: ReactNode;
  side?: "top" | "bottom";
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  return (
    <div
      className={cn("group/tooltip relative inline-flex items-center", className)}
      onMouseEnter={() => {
        timer.current = setTimeout(() => setOpen(true), 300);
      }}
      onMouseLeave={() => {
        if (timer.current) clearTimeout(timer.current);
        setOpen(false);
      }}
    >
      {children}
      {content != null && (
        <div
          className={cn(
            "pointer-events-none absolute left-1/2 z-50 w-max max-w-[260px] -translate-x-1/2 rounded-lg bg-gray-900/95 px-2.5 py-1.5 text-xs text-white shadow-2xl backdrop-blur-sm transition-opacity duration-200 dark:bg-white/95 dark:text-dark",
            side === "top" ? "bottom-full mb-2" : "top-full mt-2",
            open ? "opacity-100" : "opacity-0",
          )}
        >
          {content}
        </div>
      )}
    </div>
  );
}
