import { NextResponse } from "next/server";
import { ReferenceNotFound, parseOutliersParams, queryOutliers } from "@/lib/research/outliers";

// Same parameters and response shape as the original /api/outliers/videos.
export async function GET(req: Request) {
  const started = performance.now();
  const params = parseOutliersParams(new URL(req.url).searchParams);
  try {
    const result = queryOutliers(params);
    return NextResponse.json(result, {
      headers: { "Server-Timing": `query;dur=${(performance.now() - started).toFixed(1)}` },
    });
  } catch (err) {
    if (err instanceof ReferenceNotFound) {
      return NextResponse.json({ success: false, error: err.message }, { status: 404 });
    }
    console.error("outliers query failed", err);
    return NextResponse.json({ success: false, error: "Failed to load videos" }, { status: 500 });
  }
}
