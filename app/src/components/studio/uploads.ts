"use client";

import { toast } from "@/components/ui/Toaster";

// Client side of Studio thumbnail uploads (POST /api/studio/thumbnails).

export const IMAGE_ACCEPT = "image/png,image/jpeg,image/jpg,image/webp";
const MAX_BYTES = 5 * 1024 * 1024;

const isAcceptedImage = (f: File) =>
  ["image/png", "image/jpeg", "image/jpg", "image/webp"].includes(f.type.toLowerCase()) || /\.(png|jpe?g|webp)$/i.test(f.name);

/** Downscale big images to a 1280px JPEG (the original does the same before upload). */
async function resizeForUpload(file: File, maxSide = 1280, quality = 0.85): Promise<File> {
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    const ctx = canvas.getContext("2d");
    if (!ctx) return file;
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
    if (!blob) return file;
    return new File([blob], `${file.name.replace(/\.[^.]+$/, "") || "thumbnail"}.jpg`, { type: "image/jpeg" });
  } catch {
    return file;
  }
}

/** Filter a drop / file-picker selection down to uploadable images (toasting the rejects). */
export async function prepareImageFiles(list: FileList | File[]): Promise<File[]> {
  const out: File[] = [];
  for (const file of Array.from(list)) {
    if (!isAcceptedImage(file)) {
      toast.error("Upload a PNG, JPG, or WEBP image");
      continue;
    }
    const ready = file.size > MAX_BYTES ? await resizeForUpload(file) : file;
    if (ready.size > MAX_BYTES) toast.error("Image must be less than 5 MB");
    else out.push(ready);
  }
  return out;
}

type UploadResult = { publicUrl: string; key: string };

async function readResult(res: Response): Promise<UploadResult> {
  const body = (await res.json().catch(() => ({}))) as { data?: UploadResult; error?: string };
  if (!res.ok || !body.data?.publicUrl) throw new Error(body.error ?? "Couldn't upload the Studio thumbnail");
  return body.data;
}

export async function uploadThumbnail(file: File): Promise<UploadResult> {
  const form = new FormData();
  form.append("file", file);
  return readResult(await fetch("/api/studio/thumbnails", { method: "POST", body: form }));
}

/** Copy a YouTube video's thumbnail into Studio uploads. */
export async function importVideoThumbnail(videoId: string): Promise<UploadResult> {
  return readResult(
    await fetch("/api/studio/thumbnails", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ videoId }),
    }),
  );
}
