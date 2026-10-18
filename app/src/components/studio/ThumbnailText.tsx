import type { CSSProperties } from "react";
import { cn } from "@/lib/format";
import { textAnchor, type StyleSettings } from "./model";
import { studioFontFamily } from "./fonts";

/** Text overlay on a thumbnail. Size is relative to the thumbnail width (cqw) unless `fontPx` is given. */
export function ThumbnailText({
  text,
  style,
  fontPx,
  compact = false,
}: {
  text: string;
  style: Partial<StyleSettings> | undefined;
  fontPx?: number;
  compact?: boolean;
}) {
  if (!text) return null;
  const pos = textAnchor(style);
  const size = style?.fontSize || 24;
  const css: CSSProperties = {
    fontFamily: studioFontFamily(style?.font),
    fontSize: fontPx != null ? `${fontPx}px` : `${(size / 320) * 100}cqw`,
    color: style?.fontColor || "#FFFFFF",
    textAlign: style?.textAlign || "center",
    lineHeight: compact ? 1.1 : undefined,
  };
  return (
    <div
      className="absolute flex items-center justify-center"
      style={{
        left: `${pos.x}%`,
        top: `${pos.y}%`,
        transform: "translate(-50%, -50%)",
        maxWidth: compact ? "90%" : "85%",
        padding: compact ? "0 2px" : "0 16px",
      }}
    >
      <span className={cn("whitespace-pre-line font-bold select-none", compact ? "drop-shadow-sm" : "drop-shadow-md")} style={css}>
        {text}
      </span>
    </div>
  );
}

/** Gradient shown when a combo has no thumbnail image. */
export function ThumbnailPlaceholder({ dark }: { dark?: boolean }) {
  return (
    <div
      className={cn(
        "absolute inset-0 bg-gradient-to-br opacity-80",
        dark === undefined ? "from-[#94a3b8] to-[#164466] dark:from-[#475569] dark:to-[#0f2942]" : dark ? "from-[#475569] to-[#0f2942]" : "from-[#94a3b8] to-[#164466]",
      )}
      aria-hidden
    />
  );
}
