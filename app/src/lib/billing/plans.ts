// Plan and credit-pack shapes shared by the billing API and the Billing tab.
// HookLab has no payment processor: these drive a local ledger only.

export type PlanId = "creator" | "pro" | "agency";
export type BillingInterval = "month" | "year";
export type WarningLevel = "none" | "near" | "critical" | "exhausted";

export type Plan = {
  id: PlanId;
  name: string;
  description: string;
  /** Price per month on monthly billing. */
  monthlyPrice: number;
  /** Total charged per year on annual billing. */
  annualPrice: number;
  /** annualPrice / 12, rounded (what the card shows with "Billed yearly" on). */
  monthlyEquivalent: number;
  /** 12 × monthlyPrice − annualPrice. */
  yearlySavings: number;
  maxChannels: number;
  maxTeamMembers: number;
  monthlyCredits: number;
  /** Features added by this tier (the previous tier's are included). */
  features: string[];
  includesPrevious: PlanId | null;
};

export type CreditPack = { id: string; credits: number; priceUsd: number; note: string | null };

export type CreditUsage = {
  type: "credits";
  periodType: "monthly";
  periodStartsAt: string;
  periodEndsAt: string;
  planCredits: number;
  /** One-time pack credits added to this period. */
  grantedCredits: number;
  creditLimit: number;
  usedCredits: number;
  creditsRemaining: number;
  percentUsed: number;
  warningLevel: WarningLevel;
};

export type LedgerEntry = {
  id: string;
  kind: "plan_change" | "credit_pack";
  planId: string | null;
  interval: BillingInterval | null;
  credits: number;
  amountUsd: number;
  description: string;
  createdAt: string;
};

export type BillingSummary = {
  /** Always true: plan and pack changes only update the local ledger. */
  local: true;
  plans: Plan[];
  creditPacks: CreditPack[];
  currentPlanId: PlanId;
  currentPlanName: string;
  interval: BillingInterval;
  currentPriceLabel: string;
  subscriptionStatus: "ACTIVE";
  usage: CreditUsage;
  limits: { maxChannels: number; channelCount: number; maxTeamMembers: number };
  history: LedgerEntry[];
};

export const PLAN_RANK: Record<string, number> = { free: 0, creator: 1, pro: 2, agency: 3 };

export const intervalLabel = (i: BillingInterval) => (i === "year" ? "Annual" : "Monthly");

export const priceLabel = (plan: Plan, interval: BillingInterval) =>
  interval === "year" ? `$${plan.annualPrice}/year` : `$${plan.monthlyPrice}/month`;

/** One-line plan summary used in the plan-change confirmation. */
export function planPitch(plan: Plan): string {
  const credits = plan.monthlyCredits.toLocaleString("en-US");
  const outliers = plan.id === "creator" ? "" : "Outliers plus ";
  return `${outliers}up to ${plan.maxChannels} channels and ${credits} credits a month.`;
}

export function percentUsed(used: number, limit: number) {
  return limit <= 0 ? 0 : Math.min(100, Math.max(0, Math.round((used / limit) * 100)));
}

// Thresholds for the credit warning (inferred from the original's "80%" and "Only N remain" copy).
export function warningLevelFor(used: number, limit: number): WarningLevel {
  if (limit <= 0 || used >= limit) return "exhausted";
  const share = used / limit;
  if (share >= 0.95) return "critical";
  if (share >= 0.8) return "near";
  return "none";
}

/** Window event fired after a local plan or credit change (original: creator-hooks:credit-status-updated). */
export const CREDIT_STATUS_UPDATED = "hooklab:credit-status-updated";
