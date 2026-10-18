import { NextResponse } from "next/server";
import { resetLocalData } from "../_lib/account";
import { errorResponse, readJson } from "../_lib/http";

// POST /api/user/reset { confirm: "RESET" } -> { success, clearedTables }
// Danger Zone stand-in for "Delete Account": clears data/app.db and re-imports the account
// export. The library database is never touched.
export async function POST(req: Request) {
  try {
    const { confirm } = await readJson(req);
    if (confirm !== "RESET") return NextResponse.json({ error: 'Send { "confirm": "RESET" } to reset local data' }, { status: 400 });
    return NextResponse.json({ success: true, ...resetLocalData() });
  } catch (err) {
    return errorResponse(err);
  }
}
