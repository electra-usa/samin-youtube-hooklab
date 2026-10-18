import { NextResponse } from "next/server";
import { changePlan } from "@/lib/billing/ledger";
import { errorResponse, readJson } from "@/app/api/user/_lib/http";

// POST /api/billing/plan { planId: "creator"|"pro"|"agency", interval: "month"|"year" } -> BillingSummary
// Local stand-in for /api/stripe/change-plan: no payment is taken; the plan sets the monthly credit limit.
export async function POST(req: Request) {
  try {
    const { planId, interval } = await readJson(req);
    return NextResponse.json(changePlan(planId, interval));
  } catch (err) {
    return errorResponse(err);
  }
}
