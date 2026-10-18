"use client";

import { TRIGGER_PILL_CLASSES, triggerColor } from "@/lib/taxonomy";
import { cn } from "@/lib/format";

export function TriggerChip({
  trigger,
  onClick,
  active,
}: {
  trigger: string;
  onClick?: (trigger: string) => void;
  active?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick ? () => onClick(trigger) : undefined}
      className={cn(
        "flex-shrink-0 rounded px-1.5 py-0.5 text-[11px] font-medium transition-colors",
        TRIGGER_PILL_CLASSES[triggerColor(trigger)],
        onClick ? "cursor-pointer hover:opacity-90" : "cursor-default",
        active && "ring-1 ring-primary",
      )}
    >
      {trigger}
    </button>
  );
}

export function TriggerChips({
  triggers,
  onSelect,
  activeTriggers,
}: {
  triggers: string[];
  onSelect?: (trigger: string) => void;
  activeTriggers?: string[];
}) {
  if (!triggers.length) return null;
  return (
    <div className="flex items-center gap-1 overflow-hidden">
      {triggers.map((t) => (
        <TriggerChip key={t} trigger={t} onClick={onSelect} active={activeTriggers?.includes(t)} />
      ))}
    </div>
  );
}
