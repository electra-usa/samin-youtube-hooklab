import "server-only";
import fs from "node:fs";
import type { DatabaseSync } from "node:sqlite";
import { appDb, getSetting, listUserChannels, newId, nowIso, setSetting, tx } from "@/lib/db/app";
import { DEFAULT_CREDIT_PACKS, DEFAULT_PLANS } from "./default-plans";
import {
  PLAN_RANK,
  intervalLabel,
  percentUsed,
  priceLabel,
  warningLevelFor,
  type BillingInterval,
  type BillingSummary,
  type CreditPack,
  type CreditUsage,
  type LedgerEntry,
  type Plan,
  type PlanId,
} from "./plans";

// Local billing. HookLab has no payment processor, so "subscribing" or "buying" only
// updates the `credits` setting (read by Chat for its usage limit) and appends a row to
// billing_ledger. Usage is the sum of credit_usage rows inside the current monthly period.

export class BillingError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

const PRICING_JSON = process.env.PRICING_JSON_PATH ?? null;

type Row = Record<string, unknown>;
type RawPlan = {
  id: string;
  name: string;
  description: string;
  monthlyPrice: number;
  annualTotal: number | null;
  annualSavings: number | null;
  channels: number;
  teamMembers: number;
  creditsPerMonth: number;
  features: string[];
  includesPrevious: string | null;
};

function readPricing(): { plans: RawPlan[]; packs: CreditPack[] } {
  // Optional override file (same shape as data/pricing.json); otherwise HookLab's defaults.
  let source: { plans: RawPlan[]; creditPacks: { id: string; credits: number; price: number; note?: string | null }[] } = {
    plans: DEFAULT_PLANS,
    creditPacks: DEFAULT_CREDIT_PACKS,
  };
  if (PRICING_JSON && fs.existsSync(PRICING_JSON)) {
    source = JSON.parse(fs.readFileSync(PRICING_JSON, "utf8"));
  }
  return {
    plans: source.plans,
    packs: source.creditPacks.map((p) => ({ id: p.id, credits: p.credits, priceUsd: p.price, note: p.note ?? null })),
  };
}

function toPlan(r: RawPlan): Plan {
  const annual = r.annualTotal ?? 0;
  // The export's monthlyPrice is what each card displayed; Creator and Agency had their
  // "Billed yearly" toggle on, so it holds the annual monthly equivalent. The original
  // derives savings as 12 × monthly − annual, so monthly = (annual + savings) / 12
  // ($19 / $49 / $99), which reproduces Pro's $49 and every "Save $N" label.
  const monthly =
    r.annualTotal != null && r.annualSavings != null ? Math.round((r.annualTotal + r.annualSavings) / 12) : r.monthlyPrice;
  return {
    id: r.id as PlanId,
    name: r.name,
    description: r.description,
    monthlyPrice: monthly,
    annualPrice: annual,
    monthlyEquivalent: Math.round(annual / 12),
    yearlySavings: 12 * monthly - annual,
    maxChannels: r.channels,
    maxTeamMembers: r.teamMembers,
    monthlyCredits: r.creditsPerMonth,
    features: r.features ?? [],
    includesPrevious: (r.includesPrevious as PlanId | null) ?? null,
  };
}

export function loadPricing(): { plans: Plan[]; packs: CreditPack[] } {
  const { plans, packs } = readPricing();
  return {
    plans: plans.map(toPlan).sort((a, b) => (PLAN_RANK[a.id] ?? 9) - (PLAN_RANK[b.id] ?? 9)),
    packs,
  };
}

let ledgerReady = false;
function ledgerDb(): DatabaseSync {
  const d = appDb();
  if (!ledgerReady) {
    d.exec(`CREATE TABLE IF NOT EXISTS billing_ledger (
      id TEXT PRIMARY KEY, kind TEXT NOT NULL, plan_id TEXT, interval TEXT, credits INTEGER NOT NULL DEFAULT 0,
      amount_usd REAL NOT NULL DEFAULT 0, description TEXT NOT NULL, created_at TEXT NOT NULL
    )`);
    ledgerReady = true;
  }
  return d;
}

/** Shape of the `credits` setting (seeded with plan, monthlyLimit and periodEndsAt). */
type CreditState = {
  plan: PlanId;
  interval: BillingInterval;
  planCredits: number;
  grantedCredits: number;
  /** planCredits + grantedCredits: the limit Chat enforces for the current period. */
  monthlyLimit: number;
  periodStartsAt: string;
  periodEndsAt: string;
  updatedAt: string;
};

const validDate = (v: unknown): v is string => typeof v === "string" && !Number.isNaN(Date.parse(v));

function addMonths(iso: string, months: number): string {
  const d = new Date(iso);
  const day = d.getUTCDate();
  const t = new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + months, 1, d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds(), d.getUTCMilliseconds()),
  );
  const lastDay = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 0)).getUTCDate();
  t.setUTCDate(Math.min(day, lastDay));
  return t.toISOString();
}

/** Current credit state, normalized and rolled forward into the current monthly period. */
function creditState(plans: Plan[]): CreditState {
  const raw = getSetting<Partial<CreditState>>("credits", {});
  const plan = plans.find((p) => p.id === raw.plan) ?? plans.find((p) => p.id === "pro") ?? plans[0];
  const planCredits = plan.monthlyCredits;
  let granted =
    typeof raw.grantedCredits === "number" ? raw.grantedCredits : Math.max(0, (raw.monthlyLimit ?? planCredits) - planCredits);
  let ends = validDate(raw.periodEndsAt) ? raw.periodEndsAt : addMonths(nowIso(), 1);
  let starts = validDate(raw.periodStartsAt) ? raw.periodStartsAt : addMonths(ends, -1);
  // Credits reset monthly (on annual billing too); pack credits don't roll over. Step from
  // the stored end date so a period ending on the 31st keeps its day where months allow.
  const now = Date.now();
  if (Date.parse(ends) <= now) {
    const anchor = ends;
    let n = 1;
    while (Date.parse(addMonths(anchor, n)) <= now) n++;
    starts = addMonths(anchor, n - 1);
    ends = addMonths(anchor, n);
    granted = 0;
  }
  const state: CreditState = {
    plan: plan.id,
    interval: raw.interval === "year" ? "year" : "month",
    planCredits,
    grantedCredits: granted,
    monthlyLimit: planCredits + granted,
    periodStartsAt: starts,
    periodEndsAt: ends,
    updatedAt: validDate(raw.updatedAt) ? raw.updatedAt : nowIso(),
  };
  const changed = (Object.keys(state) as (keyof CreditState)[]).some((k) => raw[k] !== state[k]);
  if (changed) setSetting("credits", state);
  return state;
}

function usedCredits(fromIso: string, toIso: string): number {
  const row = appDb()
    .prepare(
      `SELECT COALESCE(SUM(credits), 0) AS used FROM credit_usage
       WHERE julianday(created_at) >= julianday(?) AND julianday(created_at) < julianday(?)`,
    )
    .get(fromIso, toIso) as { used: number } | undefined;
  return Number(row?.used ?? 0);
}

function usageFor(state: CreditState): CreditUsage {
  const used = usedCredits(state.periodStartsAt, state.periodEndsAt);
  const limit = state.monthlyLimit;
  return {
    type: "credits",
    periodType: "monthly",
    periodStartsAt: state.periodStartsAt,
    periodEndsAt: state.periodEndsAt,
    planCredits: state.planCredits,
    grantedCredits: state.grantedCredits,
    creditLimit: limit,
    usedCredits: used,
    creditsRemaining: Math.max(0, limit - used),
    percentUsed: percentUsed(used, limit),
    warningLevel: warningLevelFor(used, limit),
  };
}

function ledgerHistory(limit = 30): LedgerEntry[] {
  const rows = ledgerDb().prepare("SELECT * FROM billing_ledger ORDER BY created_at DESC LIMIT ?").all(limit) as Row[];
  return rows.map((r) => ({
    id: String(r.id),
    kind: r.kind as LedgerEntry["kind"],
    planId: r.plan_id == null ? null : String(r.plan_id),
    interval: r.interval === "year" || r.interval === "month" ? r.interval : null,
    credits: Number(r.credits ?? 0),
    amountUsd: Number(r.amount_usd ?? 0),
    description: String(r.description),
    createdAt: String(r.created_at),
  }));
}

/** Seats in use: the owner plus teammates who joined (pending invites don't count). */
function teamSeats(): number {
  try {
    const row = appDb().prepare("SELECT count(*) AS n FROM team_members WHERE status = 'member'").get() as { n: number };
    return 1 + Number(row.n);
  } catch {
    return 1; // team table not created yet
  }
}

export function currentPlan(): Plan {
  const { plans } = loadPricing();
  const state = creditState(plans);
  return plans.find((p) => p.id === state.plan)!;
}

export function billingSummary(): BillingSummary {
  const { plans, packs } = loadPricing();
  const state = creditState(plans);
  const plan = plans.find((p) => p.id === state.plan)!;
  return {
    local: true,
    plans,
    creditPacks: packs,
    currentPlanId: plan.id,
    currentPlanName: plan.name,
    interval: state.interval,
    currentPriceLabel: priceLabel(plan, state.interval),
    subscriptionStatus: "ACTIVE",
    usage: usageFor(state),
    limits: { maxChannels: plan.maxChannels, channelCount: listUserChannels().length, maxTeamMembers: plan.maxTeamMembers },
    history: ledgerHistory(),
  };
}

export function changePlan(planIdInput: unknown, intervalInput: unknown): BillingSummary {
  const { plans } = loadPricing();
  const plan = plans.find((p) => p.id === planIdInput);
  if (!plan) throw new BillingError("Unknown plan");
  if (intervalInput !== "month" && intervalInput !== "year") throw new BillingError("interval must be month or year");
  const interval: BillingInterval = intervalInput;
  const state = creditState(plans);
  if (state.plan === plan.id && state.interval === interval) {
    throw new BillingError(`You're already on ${plan.name} with ${intervalLabel(interval).toLowerCase()} billing`);
  }
  const channels = listUserChannels().length;
  if (channels > plan.maxChannels) {
    throw new BillingError(`${plan.name} includes ${plan.maxChannels} channels and you have ${channels}. Remove channels first.`);
  }
  const seats = teamSeats();
  if (seats > plan.maxTeamMembers) {
    throw new BillingError(`${plan.name} includes ${plan.maxTeamMembers} team members and your team has ${seats}. Remove members first.`);
  }
  const from = plans.find((p) => p.id === state.plan);
  const rank = (id: string) => PLAN_RANK[id] ?? 0;
  const verb = !from || from.id === plan.id ? "Switched" : rank(plan.id) > rank(from.id) ? "Upgraded" : "Downgraded";
  const now = nowIso();
  ledgerDb();
  tx((d) => {
    setSetting("credits", {
      ...state,
      plan: plan.id,
      interval,
      planCredits: plan.monthlyCredits,
      monthlyLimit: plan.monthlyCredits + state.grantedCredits,
      updatedAt: now,
    } satisfies CreditState);
    d.prepare(
      "INSERT INTO billing_ledger (id, kind, plan_id, interval, credits, amount_usd, description, created_at) VALUES (?, 'plan_change', ?, ?, ?, ?, ?, ?)",
    ).run(
      newId(),
      plan.id,
      interval,
      plan.monthlyCredits,
      interval === "year" ? plan.annualPrice : plan.monthlyPrice,
      `${verb} to ${plan.name}, ${intervalLabel(interval).toLowerCase()} billing (${priceLabel(plan, interval)})`,
      now,
    );
  });
  return billingSummary();
}

export function addCreditPack(packIdInput: unknown): { summary: BillingSummary; credits: number } {
  const { plans, packs } = loadPricing();
  const pack = packs.find((p) => p.id === packIdInput);
  if (!pack) throw new BillingError("Unknown credit pack");
  const state = creditState(plans);
  const granted = state.grantedCredits + pack.credits;
  const now = nowIso();
  ledgerDb();
  tx((d) => {
    setSetting("credits", {
      ...state,
      grantedCredits: granted,
      monthlyLimit: state.planCredits + granted,
      updatedAt: now,
    } satisfies CreditState);
    d.prepare(
      "INSERT INTO billing_ledger (id, kind, plan_id, interval, credits, amount_usd, description, created_at) VALUES (?, 'credit_pack', NULL, NULL, ?, ?, ?, ?)",
    ).run(newId(), pack.credits, pack.priceUsd, `Added ${pack.credits.toLocaleString("en-US")} credits to this billing period`, now);
  });
  return { summary: billingSummary(), credits: pack.credits };
}

/** Same shape as the original GET /api/user/trial-status for a paying customer. */
export function trialStatus() {
  const { plans, packs } = loadPricing();
  const state = creditState(plans);
  const usage = usageFor(state);
  return {
    status: "ACTIVE" as const,
    expired: false,
    isPostTrialGrace: false,
    isPayingCustomer: true,
    canUpgradeCreditPlan: state.plan !== "agency",
    creditPacksAvailable: packs.length > 0,
    creditLimit: usage.creditLimit,
    usedCredits: usage.usedCredits,
    creditsRemaining: usage.creditsRemaining,
    creditPeriodEndsAt: usage.periodEndsAt,
    creditWarningLevel: usage.warningLevel,
    plan: state.plan,
    local: true,
  };
}

/** Same shape as the original GET /api/user/channel-limit. */
export function channelLimit() {
  const { plans } = loadPricing();
  const plan = plans.find((p) => p.id === creditState(plans).plan)!;
  const channelCount = listUserChannels().length;
  const atLimit = channelCount >= plan.maxChannels;
  const next = plans.find((p) => (PLAN_RANK[p.id] ?? 0) === (PLAN_RANK[plan.id] ?? 0) + 1);
  return {
    maxChannels: plan.maxChannels,
    channelCount,
    atLimit,
    upgradeMessage: atLimit
      ? next
        ? `Upgrade to ${next.name} to add up to ${next.maxChannels} channels.`
        : "You're on the largest plan."
      : null,
    canManageBilling: true,
  };
}
