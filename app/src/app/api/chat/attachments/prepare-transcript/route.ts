import { NextResponse } from "next/server";
import { draftAttachment, pastedTranscript } from "@/lib/chat/attachments";
import { PASTED_TRANSCRIPT_MAX_CHARS } from "@/lib/chat/constants";
import { fetchTranscript } from "@/lib/chat/youtube";

// Turn a YouTube URL (via yt-dlp auto-captions) or pasted text into a transcript attachment draft.
// Body: { sourceType: "youtube_url" | "pasted", value } → { attachment }
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { sourceType?: unknown; value?: unknown };
  const value = typeof body.value === "string" ? body.value : "";
  if (!value.trim()) return NextResponse.json({ error: "Nothing to attach" }, { status: 400 });

  try {
    if (body.sourceType === "pasted") return NextResponse.json({ attachment: pastedTranscript(value) });
    if (body.sourceType !== "youtube_url") return NextResponse.json({ error: "Unknown sourceType" }, { status: 400 });

    const t = await fetchTranscript(value);
    const text = t.text.length > PASTED_TRANSCRIPT_MAX_CHARS ? t.text.slice(0, PASTED_TRANSCRIPT_MAX_CHARS) : t.text;
    const attachment = draftAttachment({
      type: "transcript",
      sourceType: "youtube_url",
      label: t.title ? `${t.title}${t.channel ? ` — ${t.channel}` : ""}` : `Transcript of ${t.videoId}`,
      text,
      sourceUrl: `https://www.youtube.com/watch?v=${t.videoId}`,
      sourceVideoId: t.videoId,
    });
    return NextResponse.json({ attachment, truncated: text.length < t.text.length });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Failed to attach transcript." }, { status: 422 });
  }
}
