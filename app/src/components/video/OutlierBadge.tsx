"use client";

import { tierForScore } from "@/lib/taxonomy";
import { cn, formatOutlier } from "@/lib/format";
import { Tooltip } from "@/components/ui/Tooltip";

// Outlier multiplier chip, colored by performance tier (2.9x yellow, 8.9x green, 10x+ blue...).
export function OutlierBadge({
  score,
  context = "channel",
  className,
}: {
  score: number | null | undefined;
  /** "channel": vs. the channel's average; "mine": vs. your own recent average. */
  context?: "channel" | "mine";
  className?: string;
}) {
  // On your own channel everything under 1x reads as one neutral gray, as in the original.
  const tier = context === "mine" && score != null && score < 1 ? null : tierForScore(score);
  const label = formatOutlier(score);
  const tip =
    score == null
      ? null
      : context === "mine"
        ? score >= 1
          ? `This video got ${label} more views than your channel's recent average`
          : "This video got fewer views than your channel's recent average"
        : `This video got ${label} the channel's average views`;
  return (
    <Tooltip content={tip}>
      <span
        className={cn(
          "font-roboto inline-flex items-center rounded px-1.5 py-0.5 text-xs font-medium",
          tier?.badgeClass ?? "bg-gray-500/10 text-gray-500",
          className,
        )}
      >
        {label}
      </span>
    </Tooltip>
  );
}
