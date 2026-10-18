"use client";

import { Check, ChevronDown } from "lucide-react";
import { Popover } from "@/components/ui/Popover";
import { cn } from "@/lib/format";
import { PROJECT_STATUSES, statusOption, type ProjectStatus } from "@/lib/projects/status";

/** Status chip that opens a menu of statuses (original ProjectStatusDropdown). */
export function ProjectStatusMenu({
  status,
  onChange,
  disabled,
  compact,
  showChevron = true,
  align = "left",
  onOpenChange,
  className,
}: {
  status: ProjectStatus;
  onChange: (status: ProjectStatus) => void;
  disabled?: boolean;
  compact?: boolean;
  showChevron?: boolean;
  align?: "left" | "right";
  onOpenChange?: (open: boolean) => void;
  className?: string;
}) {
  const current = statusOption(status);
  return (
    <Popover
      align={align}
      className={className}
      panelClassName="w-44 min-w-0"
      onOpenChange={onOpenChange}
      trigger={({ toggle, open }) => (
        <button
          type="button"
          disabled={disabled}
          onClick={toggle}
          aria-haspopup="menu"
          aria-expanded={open}
          aria-label={`Project status: ${current.label}`}
          className={cn(
            "inline-flex items-center rounded-full border text-xs font-normal transition hover:brightness-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 disabled:cursor-not-allowed disabled:opacity-60",
            compact ? "min-h-6 px-2 py-0.5" : "min-h-8 px-2.5 py-1",
            showChevron && "gap-1.5",
            current.chipClass,
          )}
        >
          {current.label}
          {showChevron && <ChevronDown className="size-3.5" aria-hidden />}
        </button>
      )}
    >
      {(close) => (
        <div role="menu" aria-label="Project status">
          {PROJECT_STATUSES.map((option) => {
            const active = option.value === status;
            return (
              <button
                key={option.value}
                type="button"
                role="menuitemradio"
                aria-checked={active}
                onClick={() => {
                  close();
                  if (!active) onChange(option.value);
                }}
                className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm transition hover:bg-gray-100 dark:hover:bg-white/10"
              >
                <span className={cn("inline-flex rounded-full border px-2 py-0.5 text-xs", option.chipClass)}>{option.label}</span>
                {active && <Check className="ml-auto size-4 text-primary dark:text-sky-300" aria-hidden />}
              </button>
            );
          })}
        </div>
      )}
    </Popover>
  );
}
