import { NextResponse } from "next/server";
import { updateProfile } from "../_lib/account";
import { errorResponse, readJson } from "../_lib/http";

// POST /api/user/update { name, email } -> { success, user }
export async function POST(req: Request) {
  try {
    const user = updateProfile(await readJson(req));
    return NextResponse.json({ success: true, user });
  } catch (err) {
    return errorResponse(err);
  }
}
