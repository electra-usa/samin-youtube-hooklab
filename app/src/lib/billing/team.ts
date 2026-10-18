import "server-only";
import type { DatabaseSync } from "node:sqlite";
import { appDb, currentUser, newId, nowIso } from "@/lib/db/app";
import { loadPricing, currentPlan } from "./ledger";
import { PLAN_RANK } from "./plans";

// Local team list. HookLab is single-user and sends no email, so invitations are just
// recorded here; "Mark as joined" stands in for a teammate accepting.

export class TeamError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

const INVITE_DAYS = 7;

let ready = false;
function db(): DatabaseSync {
  const d = appDb();
  if (!ready) {
    d.exec(`CREATE TABLE IF NOT EXISTS team_members (
      id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, name TEXT, role TEXT NOT NULL DEFAULT 'EDITOR',
      status TEXT NOT NULL DEFAULT 'pending', invited_at TEXT NOT NULL, expires_at TEXT, joined_at TEXT, last_sent_at TEXT
    )`);
    ready = true;
  }
  return d;
}

export type TeamPerson = {
  id: string;
  type: "owner" | "member" | "invite";
  name: string;
  email: string | null;
  image: string | null;
  role: "OWNER" | "EDITOR";
  invitedAt: string | null;
  expiresAt: string | null;
  joinedAt: string | null;
};

export type TeamState = {
  team: { name: string; people: TeamPerson[] } | null;
  maxTeamMembers: number;
  seatsUsed: number;
  atLimit: boolean;
  upgradeMessage: string | null;
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const addDays = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString();

export function getTeam(): TeamState {
  const rows = db().prepare("SELECT * FROM team_members ORDER BY invited_at ASC").all() as Record<string, unknown>[];
  const plan = currentPlan();
  const members = rows.filter((r) => r.status === "member");
  const seatsUsed = 1 + members.length;
  const atLimit = seatsUsed >= plan.maxTeamMembers;
  const { plans } = loadPricing();
  const next = plans.find((p) => (PLAN_RANK[p.id] ?? 0) === (PLAN_RANK[plan.id] ?? 0) + 1);
  const upgradeMessage = atLimit
    ? next
      ? `${plan.name} includes ${plan.maxTeamMembers} team members. Upgrade to ${next.name} for up to ${next.maxTeamMembers}.`
      : `${plan.name} includes up to ${plan.maxTeamMembers} team members.`
    : null;
  if (!rows.length) return { team: null, maxTeamMembers: plan.maxTeamMembers, seatsUsed, atLimit, upgradeMessage };

  const user = currentUser();
  const ownerName = user?.name?.trim() || user?.email || "You";
  const people: TeamPerson[] = [
    {
      id: "owner",
      type: "owner",
      name: ownerName,
      email: user?.email ?? null,
      image: user?.image ?? null,
      role: "OWNER",
      invitedAt: null,
      expiresAt: null,
      joinedAt: null,
    },
    ...rows.map((r) => ({
      id: String(r.id),
      type: (r.status === "member" ? "member" : "invite") as TeamPerson["type"],
      name: (typeof r.name === "string" && r.name.trim()) || String(r.email),
      email: String(r.email),
      image: null,
      role: "EDITOR" as const,
      invitedAt: String(r.invited_at),
      expiresAt: r.expires_at == null ? null : String(r.expires_at),
      joinedAt: r.joined_at == null ? null : String(r.joined_at),
    })),
  ];
  // Members first, then pending invitations (as in the original list).
  people.sort((a, b) => Number(a.type === "invite") - Number(b.type === "invite"));
  return { team: { name: `${ownerName}'s Team`, people }, maxTeamMembers: plan.maxTeamMembers, seatsUsed, atLimit, upgradeMessage };
}

export function inviteTeamMember(emailInput: unknown): string {
  const email = typeof emailInput === "string" ? emailInput.trim().toLowerCase() : "";
  if (!email) throw new TeamError("Please enter an email address.");
  if (!EMAIL_RE.test(email)) throw new TeamError("Please enter a valid email address.");
  const user = currentUser();
  if (user?.email && user.email.toLowerCase() === email) throw new TeamError("That's your own email address.");
  const state = getTeam();
  if (state.atLimit) throw new TeamError(state.upgradeMessage ?? "Your team is full.");
  const existing = db().prepare("SELECT status FROM team_members WHERE email = ?").get(email) as { status: string } | undefined;
  if (existing) throw new TeamError(existing.status === "member" ? `${email} is already on your team.` : `${email} already has a pending invitation.`);
  const now = nowIso();
  db()
    .prepare("INSERT INTO team_members (id, email, role, status, invited_at, expires_at, last_sent_at) VALUES (?, ?, 'EDITOR', 'pending', ?, ?, ?)")
    .run(newId(), email, now, addDays(INVITE_DAYS), now);
  return `Invitation recorded for ${email}.`;
}

function find(id: string) {
  const row = db().prepare("SELECT * FROM team_members WHERE id = ?").get(id) as Record<string, unknown> | undefined;
  if (!row) throw new TeamError("Team member not found", 404);
  return row;
}

export function resendInvitation(id: string): string {
  const row = find(id);
  if (row.status !== "pending") throw new TeamError("Only pending invitations can be resent.");
  const now = nowIso();
  db().prepare("UPDATE team_members SET expires_at = ?, last_sent_at = ? WHERE id = ?").run(addDays(INVITE_DAYS), now, id);
  return `Invitation renewed for ${row.email}.`;
}

/** Local stand-in for the teammate accepting the invitation. */
export function markInvitationJoined(id: string): string {
  const row = find(id);
  if (row.status !== "pending") throw new TeamError("This person has already joined.");
  const state = getTeam();
  if (state.atLimit) throw new TeamError(state.upgradeMessage ?? "Your team is full.");
  db().prepare("UPDATE team_members SET status = 'member', joined_at = ?, expires_at = NULL WHERE id = ?").run(nowIso(), id);
  return `${row.email} joined as an Editor.`;
}

export function removeTeamPerson(id: string): string {
  const row = find(id);
  db().prepare("DELETE FROM team_members WHERE id = ?").run(id);
  return row.status === "member" ? "Member removed." : `Invitation for ${row.email} removed.`;
}
