import { z } from "zod";
import { MAX_UPLOAD_BYTES, isAcceptedImage, saveUpload, sniffImageType } from "../_lib/store";

// Studio thumbnail upload. multipart/form-data `file` (PNG/JPG/WEBP, max 5 MB), or JSON
// { videoId } to copy a YouTube video's thumbnail in (the /studio?videoId= starting image).
// -> { success, data: { publicUrl, key } }
export async function POST(req: Request) {
  try {
    if ((req.headers.get("content-type") ?? "").includes("application/json")) {
      const parsed = z.object({ videoId: z.string().regex(/^[\w-]{11}$/) }).safeParse(await req.json().catch(() => ({})));
      if (!parsed.success) return Response.json({ success: false, error: "A valid videoId is required" }, { status: 400 });
      for (const quality of ["maxresdefault", "sddefault", "hqdefault"]) {
        const res = await fetch(`https://i.ytimg.com/vi/${parsed.data.videoId}/${quality}.jpg`, { signal: AbortSignal.timeout(10_000) }).catch(() => null);
        if (!res?.ok) continue;
        const data = Buffer.from(await res.arrayBuffer());
        // YouTube serves a 120x90 placeholder for missing sizes; skip tiny files.
        if (data.byteLength < 4_000 && quality !== "hqdefault") continue;
        const mime = sniffImageType(data);
        if (!mime) continue;
        return Response.json({ success: true, data: saveUpload(data, mime, "video-thumbnail") }, { status: 201 });
      }
      return Response.json({ success: false, error: "Couldn't fetch that video's thumbnail" }, { status: 502 });
    }

    const form = await req.formData().catch(() => null);
    const file = form?.get("file");
    if (!(file instanceof File)) return Response.json({ success: false, error: "Attach an image as `file`" }, { status: 400 });
    if (file.size > MAX_UPLOAD_BYTES) return Response.json({ success: false, error: "Image must be less than 5 MB" }, { status: 413 });
    const data = Buffer.from(await file.arrayBuffer());
    const mime = sniffImageType(data);
    if (!isAcceptedImage(mime)) return Response.json({ success: false, error: "Upload a PNG, JPG, or WEBP image" }, { status: 415 });
    return Response.json({ success: true, data: saveUpload(data, mime) }, { status: 201 });
  } catch (err) {
    return Response.json({ success: false, error: err instanceof Error ? err.message : "Upload failed" }, { status: 500 });
  }
}
