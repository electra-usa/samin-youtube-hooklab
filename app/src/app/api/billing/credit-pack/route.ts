import { NextResponse } from "next/server";
import { addCreditPack } from "@/lib/billing/ledger";
import { errorResponse, readJson } from "@/app/api/user/_lib/http";

// POST /api/billing/credit-pack { packId } -> { credits, summary }
// Local stand-in for /api/stripe/credit-pack-checkout: adds one-time credits to the current period, no charge.
export async function POST(req: Request) {
  try {
    const { packId } = await readJson(req);
    const { summary, credits } = addCreditPack(packId);
    return NextResponse.json({ credits, summary });
  } catch (err) {
    return errorResponse(err);
  }
}
