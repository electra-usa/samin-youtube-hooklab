import { NextResponse } from "next/server";
import { bookmarkRecommendations } from "@/lib/research/recommendations";
import { errorResponse } from "@/lib/research/http";

// GET ?type=longform|shorts&limit=8&exclude=id,id&seed=id,id
export async function GET(req: Request) {
  const p = new URL(req.url).searchParams;
  const ids = (key: string) => (p.get(key) ?? "").split(",").map((s) => s.trim()).filter(Boolean).slice(0, 200);
  try {
    return NextResponse.json(
      bookmarkRecommendations({
        type: p.get("type") === "shorts" ? "shorts" : "longform",
        limit: Math.min(24, Math.max(1, Number(p.get("limit")) || 8)),
        exclude: ids("exclude"),
        seedVideoIds: ids("seed"),
      }),
    );
  } catch (err) {
    return errorResponse(err, "Failed to load suggestions");
  }
}
