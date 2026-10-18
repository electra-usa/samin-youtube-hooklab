import { NextResponse } from "next/server";
import { trialStatus } from "@/lib/billing/ledger";
import { errorResponse } from "../_lib/http";

// GET /api/user/trial-status -> original shape for a paying customer:
// { status, expired, isPostTrialGrace, isPayingCustomer, canUpgradeCreditPlan, creditPacksAvailable,
//   creditLimit, usedCredits, creditsRemaining, creditPeriodEndsAt, creditWarningLevel, plan, local }
export async function GET() {
  try {
    return NextResponse.json(trialStatus());
  } catch (err) {
    return errorResponse(err);
  }
}
