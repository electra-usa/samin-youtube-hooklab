"use client";

import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/Button";
import { toast } from "@/components/ui/Toaster";
import { sendJson } from "@/lib/api-client";
import { APP_NAME } from "@/lib/brand";
import { cn, formatDate } from "@/lib/format";
import type { TeamPerson, TeamState } from "@/lib/billing/team";
import { SettingsCard, inputClass } from "./ui";

type TeamResponse = TeamState & { message: string };

const BADGE: Record<TeamPerson["type"], { label: string; className: string }> = {
  owner: { label: "Owner", className: "bg-primary text-white dark:bg-sky-600" },
  member: { label: "Editor", className: "brand-accent-blue-chip border border-accent-blue/30" },
  invite: { label: "Pending", className: "brand-accent-chip border border-accent/40" },
};

export function TeamsTab({ initialTeam }: { initialTeam: TeamState }) {
  const [state, setState] = useState(initialTeam);
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  const run = async (key: string, request: () => Promise<TeamResponse>, after?: () => void) => {
    setBusy(key);
    try {
      const res = await request();
      setState(res);
      toast.success(res.message);
      after?.();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setBusy(null);
    }
  };

  const invite = (e: FormEvent) => {
    e.preventDefault();
    if (!email.trim()) return toast.error("Please enter an email address.");
    void run("invite", () => sendJson<TeamResponse>("/api/user/team", "POST", { email }), () => setEmail(""));
  };

  const act = (person: TeamPerson, action: "resend" | "accept" | "remove") => {
    if (action === "remove") {
      const question =
        person.type === "member" ? `Remove ${person.name} from your team?` : `Remove the pending invitation for ${person.email}?`;
      if (!window.confirm(question)) return;
      void run(`${person.id}:remove`, () => sendJson<TeamResponse>(`/api/user/team/${person.id}`, "DELETE"));
      return;
    }
    void run(`${person.id}:${action}`, () => sendJson<TeamResponse>(`/api/user/team/${person.id}`, "POST", { action }));
  };

  const inviteForm = (label: string, id: string) => (
    <form onSubmit={invite} className="flex flex-wrap items-end gap-2">
      <div className="min-w-[200px] flex-1">
        <label htmlFor={id} className="sr-only">
          Email address
        </label>
        <input
          id={id}
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="teammate@example.com"
          disabled={busy === "invite" || state.atLimit}
          className={cn(inputClass, "h-12")}
        />
      </div>
      <Button type="submit" size="lg" className="px-6" disabled={busy === "invite" || state.atLimit}>
        {busy === "invite" ? "Saving…" : label}
      </Button>
    </form>
  );

  return (
    <div className="space-y-6">
      <SettingsCard
        title="Team collaboration"
        description="Invite team members to collaborate. They get access to all features, but only the owner can manage billing and team members."
      >
        <p className="-mt-2 mb-4 text-xs text-dark-5">
          {APP_NAME} is single-user, so invitations are only recorded on this Mac and no email is sent. Use &quot;Mark as joined&quot; when
          someone should count as a member.
        </p>
        {state.team ? (
          <>
            <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
              <p className="text-sm font-medium text-dark dark:text-white">{state.team.name}</p>
              <p className="text-xs text-dark-5">
                {state.seatsUsed} of {state.maxTeamMembers} seats used
              </p>
            </div>
            <ul className="mb-6 space-y-2">
              {state.team.people.map((p) => {
                const badge = BADGE[p.type];
                return (
                  <li
                    key={p.id}
                    className="flex flex-col gap-3 rounded-lg border border-stroke bg-gray-50 px-3 py-3 sm:flex-row sm:items-center sm:justify-between dark:border-white/10 dark:bg-white/5"
                  >
                    <div className="flex items-center gap-3">
                      {p.image ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={p.image} alt="" className="size-8 rounded-full object-cover" />
                      ) : (
                        <div className="flex size-8 items-center justify-center rounded-full bg-primary/15 text-sm font-medium text-primary dark:bg-sky-400/20 dark:text-white">
                          {p.name.slice(0, 1).toUpperCase()}
                        </div>
                      )}
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-sm font-medium text-dark dark:text-white">{p.name}</span>
                          {p.type !== "invite" && p.email && p.email !== p.name && <span className="text-xs text-dark-5">{p.email}</span>}
                          <span className={cn("inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold", badge.className)}>
                            {badge.label}
                          </span>
                        </div>
                        {p.type === "invite" && p.expiresAt && <p className="text-xs text-dark-5">Expires {formatDate(p.expiresAt)}</p>}
                        {p.type === "member" && p.joinedAt && <p className="text-xs text-dark-5">Joined {formatDate(p.joinedAt)}</p>}
                      </div>
                    </div>
                    {p.type !== "owner" && (
                      <div className="flex flex-wrap gap-2">
                        {p.type === "invite" && (
                          <>
                            <Button variant="soft" size="sm" disabled={!!busy} onClick={() => act(p, "resend")}>
                              {busy === `${p.id}:resend` ? "Resending…" : "Resend invite"}
                            </Button>
                            <Button variant="soft" size="sm" disabled={!!busy || state.atLimit} onClick={() => act(p, "accept")}>
                              Mark as joined
                            </Button>
                          </>
                        )}
                        <button
                          type="button"
                          disabled={!!busy}
                          onClick={() => act(p, "remove")}
                          className="rounded-lg px-3 text-sm text-red-600 transition hover:bg-red-50 hover:underline disabled:opacity-50 dark:text-red-400 dark:hover:bg-red-500/10"
                        >
                          {busy === `${p.id}:remove` ? "Removing…" : "Remove"}
                        </button>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
            {inviteForm("Invite", "team-invite-email")}
          </>
        ) : (
          <div className="rounded-lg bg-gray-100 p-4 dark:bg-white/5">
            <p className="mb-3 text-sm text-dark-5">
              Send an invitation to create your team. The first person you invite will join as an Editor; you&apos;ll be the Owner.
            </p>
            {inviteForm("Invite team member", "team-invite-email-first")}
          </div>
        )}
        {state.atLimit && state.upgradeMessage && <p className="mt-2 text-sm text-dark-5">{state.upgradeMessage}</p>}
      </SettingsCard>
    </div>
  );
}
