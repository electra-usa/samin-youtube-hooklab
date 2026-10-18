import { NextResponse } from "next/server";
import { appDb, getSetting, setSetting } from "@/lib/db/app";
import { errorResponse, readJson } from "@/app/api/user/_lib/http";

// Getting-started checklist (original: /api/getting-started). Steps are computed from the
// app DB where possible; the rest are flags set through POST actions.

const COACHMARKS = ["pin", "search_mode", "reference_search", "all_filters"] as const;

type Flags = {
  eligible?: boolean;
  completionDismissed?: boolean;
  latestTitleChatId?: string | null;
  titlesGenerated?: boolean;
  searchOutliers?: boolean;
  coachmarks?: Partial<Record<(typeof COACHMARKS)[number], boolean>>;
};

const KEY = "gettingStarted";

function progress() {
  const flags = getSetting<Flags>(KEY, {});
  const db = appDb();
  const latestTitles = db
    .prepare(
      `SELECT chat_id FROM chat_messages
       WHERE role = 'assistant' AND cards_json IS NOT NULL AND cards_json NOT IN ('', '[]', 'null')
       ORDER BY created_at DESC LIMIT 1`,
    )
    .get() as { chat_id: string } | undefined;
  return {
    // The signed-in account was not eligible (account export), so the checklist stays hidden by default.
    eligible: flags.eligible ?? false,
    completionDismissed: flags.completionDismissed ?? false,
    latestTitleChatId: flags.latestTitleChatId ?? latestTitles?.chat_id ?? null,
    steps: {
      channel: !!db.prepare("SELECT 1 FROM user_channels LIMIT 1").get(),
      generate_titles: !!flags.titlesGenerated || !!latestTitles,
      pin_title: !!db.prepare("SELECT 1 FROM pinned_titles LIMIT 1").get(),
      search_outliers: !!flags.searchOutliers,
    },
    coachmarks: Object.fromEntries(COACHMARKS.map((c) => [c, !!flags.coachmarks?.[c]])),
  };
}

// GET /api/getting-started -> { eligible, completionDismissed, latestTitleChatId, steps, coachmarks }
export async function GET() {
  try {
    return NextResponse.json(progress());
  } catch (err) {
    return errorResponse(err);
  }
}

// POST /api/getting-started { action: "complete_titles" (chatId?) | "discover_coachmark" (coachmark)
//   | "dismiss_completion" | "complete_search" (HookLab addition, for Outliers) }
export async function POST(req: Request) {
  try {
    const body = await readJson(req);
    const flags = getSetting<Flags>(KEY, {});
    switch (body.action) {
      case "complete_titles":
        flags.titlesGenerated = true;
        if (typeof body.chatId === "string" && body.chatId) flags.latestTitleChatId = body.chatId;
        break;
      case "discover_coachmark": {
        const mark = COACHMARKS.find((c) => c === body.coachmark);
        if (!mark) return NextResponse.json({ error: `coachmark must be one of: ${COACHMARKS.join(", ")}` }, { status: 400 });
        flags.coachmarks = { ...flags.coachmarks, [mark]: true };
        break;
      }
      case "dismiss_completion":
        flags.completionDismissed = true;
        break;
      case "complete_search":
        flags.searchOutliers = true;
        break;
      default:
        return NextResponse.json({ error: "Unknown action" }, { status: 400 });
    }
    setSetting(KEY, flags);
    return NextResponse.json(progress());
  } catch (err) {
    return errorResponse(err);
  }
}
