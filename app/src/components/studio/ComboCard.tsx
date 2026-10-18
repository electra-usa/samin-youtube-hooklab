"use client";

import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { cn } from "@/lib/format";
import { textAnchor, type StyleSettings } from "./model";
import { studioFontFamily } from "./fonts";
import { ThumbnailPlaceholder } from "./ThumbnailText";

type Corner = "tl" | "tr" | "bl" | "br";

/**
 * A title + thumbnail combo rendered as a YouTube card. When `interactive`, the
 * thumbnail text can be dragged to move it and resized from its corners; the
 * change applies to the shared style, so every combo moves together.
 */
export function ComboCard({
  title,
  thumbnailText,
  imageUrl,
  channelName,
  channelAvatarUrl,
  stats = "100K views • 1 day ago",
  style,
  onStyleChange,
  interactive = false,
  blurThumbnail = false,
  disableScale = false,
  titleLineClamp = 2,
  hideStats = false,
  avatarSize = 36,
  className,
}: {
  title: string;
  thumbnailText: string;
  imageUrl: string | null;
  channelName: string;
  channelAvatarUrl: string | null;
  stats?: string;
  style: StyleSettings;
  onStyleChange?: (style: StyleSettings) => void;
  interactive?: boolean;
  blurThumbnail?: boolean;
  disableScale?: boolean;
  titleLineClamp?: 1 | 2;
  hideStats?: boolean;
  avatarSize?: number;
  className?: string;
}) {
  const frameRef = useRef<HTMLDivElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const [selected, setSelected] = useState(false);
  const [mode, setMode] = useState<"idle" | "pending" | "drag" | "resize">("idle");
  const gesture = useRef<{ pointerId: number; x: number; y: number; pos: { x: number; y: number }; size: number; box: { w: number; h: number }; corner: Corner | null } | null>(null);
  const editable = interactive && !!onStyleChange;
  const pos = textAnchor(style);
  const fontSize = style.fontSize || 24;

  const begin = (e: ReactPointerEvent, corner: Corner | null) => {
    if (!editable || !frameRef.current) return;
    e.stopPropagation();
    e.preventDefault();
    const box = boxRef.current?.getBoundingClientRect();
    gesture.current = {
      pointerId: e.pointerId,
      x: e.clientX,
      y: e.clientY,
      pos,
      size: fontSize,
      box: { w: box?.width ?? 0, h: box?.height ?? 0 },
      corner,
    };
    setSelected(true);
    setMode(corner ? "resize" : "pending");
  };

  const onMove = useCallback(
    (e: PointerEvent) => {
      const g = gesture.current;
      const frame = frameRef.current?.getBoundingClientRect();
      if (!g || !frame || e.pointerId !== g.pointerId || !onStyleChange) return;
      const dx = e.clientX - g.x;
      const dy = e.clientY - g.y;
      if (mode === "pending") {
        if (Math.abs(dx) <= 5 && Math.abs(dy) <= 5) return;
        setMode("drag");
      }
      if (mode === "pending" || mode === "drag") {
        onStyleChange({
          ...style,
          textPositionX: Math.max(0, Math.min(100, g.pos.x + (dx / frame.width) * 100)),
          textPositionY: Math.max(0, Math.min(100, g.pos.y + (dy / frame.height) * 100)),
        });
      } else if (mode === "resize" && g.corner) {
        const delta = { tl: -Math.max(dx, dy), tr: Math.max(dx, -dy), bl: Math.max(-dx, dy), br: Math.max(dx, dy) }[g.corner];
        const size = Math.max(12, Math.min(200, g.size + delta / 2));
        // Keep the opposite corner in place while the box grows or shrinks.
        const growW = g.box.w * (size / g.size) - g.box.w;
        const growH = g.box.h * (size / g.size) - g.box.h;
        const sx = g.corner === "tl" || g.corner === "bl" ? -1 : 1;
        const sy = g.corner === "tl" || g.corner === "tr" ? -1 : 1;
        onStyleChange({
          ...style,
          fontSize: Math.round(size),
          textPositionX: Math.max(0, Math.min(100, g.pos.x + sx * ((growW / 2 / frame.width) * 100))),
          textPositionY: Math.max(0, Math.min(100, g.pos.y + sy * ((growH / 2 / frame.height) * 100))),
        });
      }
    },
    [mode, onStyleChange, style],
  );

  const onUp = useCallback((e: PointerEvent) => {
    if (gesture.current && e.pointerId === gesture.current.pointerId) {
      gesture.current = null;
      setMode("idle");
    }
  }, []);

  useEffect(() => {
    if (mode === "idle") return;
    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerup", onUp);
    document.addEventListener("pointercancel", onUp);
    return () => {
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", onUp);
      document.removeEventListener("pointercancel", onUp);
    };
  }, [mode, onMove, onUp]);

  // Clicking anywhere else drops the selection handles.
  useEffect(() => {
    if (!selected || !editable) return;
    const onDown = (e: PointerEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setSelected(false);
    };
    const t = setTimeout(() => document.addEventListener("pointerdown", onDown), 0);
    return () => {
      clearTimeout(t);
      document.removeEventListener("pointerdown", onDown);
    };
  }, [selected, editable]);

  const handle = (corner: Corner, cls: string) => (
    <div
      className={cn("absolute h-4 w-4 rounded-full border-2 border-primary bg-white", cls)}
      onPointerDown={(e) => begin(e, corner)}
      aria-hidden
    />
  );

  return (
    <article
      className={cn(
        "group relative overflow-hidden rounded-xl border border-stroke bg-white shadow-sm dark:border-white/10 dark:bg-[#18191c]",
        !disableScale && "scale-[0.92]",
        className,
      )}
    >
      <div
        ref={frameRef}
        className="@container relative aspect-video w-full overflow-hidden bg-[#e8e8e8] dark:bg-dark-3"
        style={blurThumbnail ? { filter: "blur(4px)" } : undefined}
      >
        {imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={imageUrl} alt="" draggable={false} className="absolute inset-0 h-full w-full object-cover" />
        ) : (
          <ThumbnailPlaceholder />
        )}
        {thumbnailText && (
          <div
            ref={boxRef}
            onPointerDown={(e) => begin(e, null)}
            className={cn("absolute flex select-none items-center justify-center", editable && selected && "ring-2 ring-primary/50")}
            style={{
              left: `${pos.x}%`,
              top: `${pos.y}%`,
              transform: "translate(-50%, -50%)",
              cursor: editable ? (mode === "drag" ? "grabbing" : "move") : "default",
              maxWidth: "85%",
              padding: "0 16px",
              touchAction: editable ? "none" : undefined,
            }}
          >
            <span
              className="select-none whitespace-pre-line font-bold drop-shadow-md"
              style={{
                fontFamily: studioFontFamily(style.font),
                fontSize: `${(fontSize / 320) * 100}cqw`,
                color: style.fontColor || "#FFFFFF",
                textAlign: style.textAlign || "center",
              }}
            >
              {thumbnailText}
            </span>
            {editable && selected && (
              <>
                {handle("tl", "-left-2 -top-2 cursor-nwse-resize")}
                {handle("tr", "-right-2 -top-2 cursor-nesw-resize")}
                {handle("bl", "-bottom-2 -left-2 cursor-nesw-resize")}
                {handle("br", "-bottom-2 -right-2 cursor-nwse-resize")}
              </>
            )}
          </div>
        )}
        <span
          className="font-roboto absolute bottom-1.5 right-1.5 inline-flex h-5 min-w-[2.6rem] items-center justify-center rounded bg-black/80 px-1.5 text-xs font-medium text-white"
          aria-hidden
        >
          12:34
        </span>
      </div>
      <div className="flex items-start gap-3 p-3 text-left">
        <div className="shrink-0">
          {channelAvatarUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={channelAvatarUrl} alt="" width={avatarSize} height={avatarSize} className="rounded-full object-cover" style={{ width: avatarSize, height: avatarSize }} />
          ) : (
            <div className="rounded-full bg-[#e8e8e8] dark:bg-dark-3" style={{ width: avatarSize, height: avatarSize }} aria-hidden />
          )}
        </div>
        <div className="min-w-0 flex-1 text-left">
          <h3
            className={cn(
              "font-roboto text-base font-medium leading-tight text-dark dark:text-white",
              titleLineClamp === 1 ? "line-clamp-1" : "line-clamp-2",
            )}
          >
            {title || "Untitled"}
          </h3>
          <p className="font-roboto mt-1 text-sm text-[var(--color-muted)]">{channelName}</p>
          {!hideStats && <p className="font-roboto text-sm text-[var(--color-muted)]">{stats}</p>}
        </div>
      </div>
    </article>
  );
}
