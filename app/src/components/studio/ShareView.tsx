"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "@/components/ui/Toaster";
import { EmptyCombos, ViewIntro, type ComboWithStyle } from "./StudioViews";
import { renderShareImage } from "./share-canvas";

const SCALE = 0.28;

/** Downloadable image of the first 8 combos for team feedback. */
export function ShareView({
  combos,
  channelName,
  channelAvatarUrl,
  onGoToWorkspace,
}: {
  combos: ComboWithStyle[];
  channelName: string;
  channelAvatarUrl: string | null;
  onGoToWorkspace: () => void;
}) {
  const first8 = useMemo(() => combos.slice(0, 8), [combos]);
  const [preview, setPreview] = useState<string | null>(null);
  const [rendering, setRendering] = useState(false);
  const [exporting, setExporting] = useState(false);
  const run = useRef(0);

  useEffect(() => {
    if (!first8.length) return;
    const id = ++run.current;
    const kick = setTimeout(() => id === run.current && setRendering(true), 0);
    renderShareImage(first8, channelName, channelAvatarUrl)
      .then((canvas) => id === run.current && setPreview(canvas.toDataURL("image/png")))
      .catch(() => id === run.current && setPreview(null))
      .finally(() => id === run.current && setRendering(false));
    return () => clearTimeout(kick);
  }, [first8, channelName, channelAvatarUrl]);

  const download = useCallback(async () => {
    if (!first8.length || exporting) return;
    setExporting(true);
    try {
      const canvas = await renderShareImage(first8, channelName, channelAvatarUrl);
      const a = document.createElement("a");
      a.download = "hooklab-share.png";
      a.href = canvas.toDataURL("image/png");
      a.click();
    } catch {
      toast.error("Couldn't create the share image");
    } finally {
      setExporting(false);
    }
  }, [first8, channelName, channelAvatarUrl, exporting]);

  if (!combos.length) return <EmptyCombos message="Add titles and thumbnails in the Workspace to get started." onGoToWorkspace={onGoToWorkspace} />;

  return (
    <div className="space-y-6">
      <ViewIntro title="Share">Download an image of your first 8 combos to share and get feedback.</ViewIntro>
      <div className="flex justify-center">
        <button
          type="button"
          onClick={download}
          disabled={rendering}
          title="Click to download image"
          aria-label="Preview of share image; click to download"
          className="cursor-pointer overflow-hidden rounded-lg border border-stroke transition-opacity hover:opacity-90 dark:border-white/10"
          style={{ width: 1080 * SCALE, height: 1350 * SCALE, backgroundColor: "#e5e7eb" }}
        >
          {preview ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={preview} alt="" width={1080} height={1350} style={{ display: "block", width: 1080 * SCALE, height: 1350 * SCALE }} />
          ) : (
            <span className="flex h-full w-full items-center justify-center text-sm text-[var(--color-muted)]">
              {rendering ? "Rendering preview..." : "Preview unavailable"}
            </span>
          )}
        </button>
      </div>
      <div className="flex justify-center">
        <button
          type="button"
          onClick={download}
          className="rounded-lg bg-primary px-6 py-3 text-base font-medium text-white transition hover:bg-primary-hover disabled:opacity-60"
          disabled={exporting}
        >
          {exporting ? "Preparing image…" : "Download image to share with your team to get their feedback."}
        </button>
      </div>
    </div>
  );
}
