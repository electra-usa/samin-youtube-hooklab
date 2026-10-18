import { NextResponse } from "next/server";
import { providerStatus } from "@/lib/ai";

// HookLab addition: which Claude provider the chat will use (for setup checks and Settings).
export async function GET() {
  return NextResponse.json(providerStatus());
}
