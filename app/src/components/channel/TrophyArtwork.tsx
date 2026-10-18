import type { CSSProperties } from "react";
import { cn } from "@/lib/format";
import { trophyThemeColor } from "@/lib/channel/trophy-format";
import { rgbTriplet, trophyDataUrl } from "./trophy-art";

const SIZES = {
  compact: { frame: "min-h-32", image: "h-28 w-28" },
  card: { frame: "min-h-56", image: "h-44 w-44" },
  hero: { frame: "min-h-72", image: "h-64 w-64" },
};

/** Framed trophy illustration; `muted` renders it grayscale (not yet earned). */
export function TrophyArtwork({
  milestone,
  title,
  size = "card",
  muted = false,
  className,
}: {
  milestone: number;
  title: string;
  size?: keyof typeof SIZES;
  muted?: boolean;
  className?: string;
}) {
  const color = trophyThemeColor(milestone);
  const s = SIZES[size];
  return (
    <div
      style={{ "--trophy-theme-rgb": rgbTriplet(color) } as CSSProperties}
      className={cn(
        "relative isolate flex items-end justify-center overflow-hidden rounded-2xl border border-stroke bg-white px-6 pt-8 text-dark shadow-inner dark:border-white/10 dark:bg-[#18191c]",
        s.frame,
        muted && "grayscale",
        className,
      )}
    >
      <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(var(--trophy-theme-rgb),0.16),rgba(255,255,255,0.78)_48%,rgba(255,255,255,1))] dark:bg-[linear-gradient(180deg,rgba(var(--trophy-theme-rgb),0.10),rgba(26,26,26,0.92)_52%,rgba(26,26,26,1))]" />
      <div className="relative z-10 flex flex-col items-center pb-5">
        <div className={cn("relative drop-shadow-2xl", s.image)}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={trophyDataUrl(milestone, color)} alt={`${title} trophy`} className="absolute inset-0 h-full w-full object-contain" />
        </div>
      </div>
    </div>
  );
}
