import { NextResponse } from "next/server";
import { billingSummary } from "@/lib/billing/ledger";
import { errorResponse } from "@/app/api/user/_lib/http";

// GET /api/billing -> BillingSummary { local, plans, creditPacks, currentPlanId, interval, usage, limits, history }
export async function GET() {
  try {
    return NextResponse.json(billingSummary());
  } catch (err) {
    return errorResponse(err);
  }
}
