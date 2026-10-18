import { NextResponse } from "next/server";
import { channelLimit } from "@/lib/billing/ledger";
import { errorResponse } from "../_lib/http";

// GET /api/user/channel-limit -> { maxChannels, channelCount, atLimit, upgradeMessage, canManageBilling }
export async function GET() {
  try {
    return NextResponse.json(channelLimit());
  } catch (err) {
    return errorResponse(err);
  }
}
