import { NextResponse } from "next/server";
import { getContentLanguages, setContentLanguages } from "../_lib/account";
import { errorResponse, readJson } from "../_lib/http";

// GET /api/user/content-languages -> { selectedContentLanguages, labels }  (empty = all languages allowed)
export async function GET() {
  try {
    return NextResponse.json(getContentLanguages());
  } catch (err) {
    return errorResponse(err);
  }
}

// PATCH /api/user/content-languages { selectedContentLanguages: ["en", ...] }
export async function PATCH(req: Request) {
  try {
    const body = await readJson(req);
    return NextResponse.json(setContentLanguages(body.selectedContentLanguages));
  } catch (err) {
    return errorResponse(err);
  }
}
