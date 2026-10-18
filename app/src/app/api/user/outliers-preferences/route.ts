import { NextResponse } from "next/server";
import { connection } from "next/server";
import { getOutliersPreferences, updateOutliersPreferences } from "@/lib/research/app-data";

// Saved Outliers defaults + hidden channels. The original used PATCH; PUT is accepted too.
export async function GET() {
  await connection();
  return NextResponse.json(getOutliersPreferences());
}

async function update(req: Request) {
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json({ error: "Expected a JSON object" }, { status: 400 });
  }
  return NextResponse.json(updateOutliersPreferences(body));
}

export const PATCH = update;
export const PUT = update;
