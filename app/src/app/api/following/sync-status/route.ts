import { NextResponse } from "next/server";
import { connection } from "next/server";
import { syncStatus } from "@/lib/research/following";

export async function GET() {
  await connection();
  return NextResponse.json(syncStatus());
}
