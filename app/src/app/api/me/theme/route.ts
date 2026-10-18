import { NextResponse } from "next/server";
import { setSetting } from "@/lib/db/app";

export async function POST(req: Request) {
  const { theme } = (await req.json().catch(() => ({}))) as { theme?: string };
  if (theme !== "light" && theme !== "dark") return NextResponse.json({ error: "theme must be light or dark" }, { status: 400 });
  setSetting("theme", theme);
  return NextResponse.json({ success: true, theme });
}
