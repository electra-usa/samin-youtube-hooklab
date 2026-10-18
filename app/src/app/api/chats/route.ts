import { NextResponse } from "next/server";
import { appDb } from "@/lib/db/app";

// Chat list for the sidebar's "Recent chats" and the /chats page (original: getRecentChats).
export async function GET(req: Request) {
  const url = new URL(req.url);
  const limit = Math.min(Number(url.searchParams.get("limit") ?? 50) || 50, 500);
  const q = url.searchParams.get("q")?.trim();
  const projectId = url.searchParams.get("projectId");
  const where: string[] = [];
  const params: (string | number)[] = [];
  if (q) {
    where.push("c.title LIKE ?");
    params.push(`%${q}%`);
  }
  if (projectId) {
    where.push("c.project_id = ?");
    params.push(projectId);
  }
  const rows = appDb()
    .prepare(
      `SELECT c.id, c.title, c.project_id AS projectId, c.created_at AS createdAt, c.updated_at AS updatedAt,
              (SELECT count(*) FROM chat_messages m WHERE m.chat_id = c.id) AS messageCount
       FROM chats c ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
       ORDER BY c.updated_at DESC LIMIT ?`,
    )
    .all(...params, limit);
  return NextResponse.json({ chats: rows });
}
