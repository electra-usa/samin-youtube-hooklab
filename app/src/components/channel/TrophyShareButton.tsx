"use client";

import { useEffect, useState } from "react";
import { Download } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { toast } from "@/components/ui/Toaster";
import { cn } from "@/lib/format";
import type { Trophy } from "@/lib/channel/trophy-format";
import { canvasToBlob, downloadBlob, renderTrophyCard } from "./trophy-share";

/** "Share" on an earned trophy: renders the share card and offers a download. */
export function TrophyShareButton({ trophy, channelName, className }: { trophy: Trophy; channelName: string; className?: string }) {
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<{ url: string; blob: Blob } | null>(null);

  useEffect(() => () => {
    if (preview) URL.revokeObjectURL(preview.url);
  }, [preview]);

  const open = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const blob = await canvasToBlob(await renderTrophyCard(trophy, channelName));
      setPreview({ url: URL.createObjectURL(blob), blob });
    } catch {
      toast.error("Failed to create share card");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={open}
        disabled={busy}
        className={cn(
          "inline-flex items-center justify-center rounded-lg border border-stroke bg-white px-3 py-1.5 text-xs font-medium text-dark transition hover:bg-gray-100 disabled:opacity-50 dark:border-white/15 dark:bg-transparent dark:text-white dark:hover:bg-white/10",
          className,
        )}
      >
        {busy ? "Creating..." : "Share"}
      </button>
      <Modal
        open={!!preview}
        onClose={() => setPreview(null)}
        title="Share your trophy"
        footer={
          <Button
            size="sm"
            onClick={() => {
              if (!preview) return;
              downloadBlob(preview.blob, "hooklab-trophy.jpg");
              toast.success("Share card downloaded");
            }}
          >
            <Download className="size-4" /> Download
          </Button>
        }
      >
        {preview && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={preview.url} alt="Trophy share card preview" className="mx-auto aspect-square max-h-[58vh] w-auto rounded-2xl bg-white object-contain shadow-sm" />
        )}
      </Modal>
    </>
  );
}
