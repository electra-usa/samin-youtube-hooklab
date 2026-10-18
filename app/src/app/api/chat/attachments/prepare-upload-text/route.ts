import { NextResponse } from "next/server";
import { uploadedText } from "@/lib/chat/attachments";
import { UPLOAD_TEXT_MAX_BYTES } from "@/lib/chat/constants";

// Upload a TXT / Markdown / SRT / VTT file as chat context (multipart field "file") → { attachment }.
// PDFs aren't supported in HookLab (no PDF text extractor is installed).
const TEXT_EXT = /\.(txt|md|markdown|srt|vtt)$/i;

export async function POST(req: Request) {
  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!file || typeof file === "string") return NextResponse.json({ error: "Attach a file in the \"file\" field" }, { status: 400 });
  if (/\.pdf$/i.test(file.name) || file.type === "application/pdf") {
    return NextResponse.json({ error: "PDFs aren't supported yet. Upload a TXT, Markdown, SRT or VTT file, or paste the text." }, { status: 415 });
  }
  if (!TEXT_EXT.test(file.name) && !file.type.startsWith("text/")) {
    return NextResponse.json({ error: "Unsupported file type. Upload a TXT, Markdown, SRT or VTT file." }, { status: 415 });
  }
  if (file.size > UPLOAD_TEXT_MAX_BYTES) {
    return NextResponse.json({ error: `${file.name} is larger than 2 MB.` }, { status: 413 });
  }
  try {
    return NextResponse.json({ attachment: uploadedText(file.name, await file.text()) });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : `Failed to attach ${file.name}.` }, { status: 422 });
  }
}
