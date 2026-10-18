"use client";

import { cn } from "@/lib/format";

// Underlined tab row (Settings: Profile/Channels/Billing/Teams; My Channel: Videos/Shorts/Livestreams).
export function Tabs<T extends string>({
  tabs,
  value,
  onChange,
  size = "md",
  className,
}: {
  tabs: { id: T; label: string }[];
  value: T;
  onChange: (id: T) => void;
  size?: "sm" | "md";
  className?: string;
}) {
  return (
    <div className={cn("flex gap-1 border-b border-stroke dark:border-white/10", className)} role="tablist">
      {tabs.map((t) => {
        const active = t.id === value;
        return (
          <button
            key={t.id}
            role="tab"
            type="button"
            aria-selected={active}
            onClick={() => onChange(t.id)}
            className={cn(
              "-mb-px border-b-2 px-4 transition-colors",
              size === "sm" ? "py-2 text-sm" : "py-3 text-[15px]",
              active
                ? "border-primary font-medium text-primary dark:border-sky-300 dark:text-sky-200"
                : "border-transparent text-dark-5 hover:text-dark dark:hover:text-white",
            )}
          >
            {t.label}
          </button>
        );
      })}
    </div>
  );
}
