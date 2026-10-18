"use client";

import { useState, type ReactNode } from "react";
import { Info } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { toast } from "@/components/ui/Toaster";
import { sendJson } from "@/lib/api-client";
import { emit } from "@/lib/client-events";
import { APP_NAME } from "@/lib/brand";
import { cn } from "@/lib/format";
import {
  CREDIT_STATUS_UPDATED,
  PLAN_RANK,
  intervalLabel,
  priceLabel,
  type BillingInterval,
  type BillingSummary,
  type Plan,
} from "@/lib/billing/plans";
import { SettingsCard, Switch } from "./ui";
import { BillingHistoryModal, ConfirmPlanModal, HowCreditsWorkModal, type PendingPlanChange } from "./BillingModals";

const fmt = (n: number) => n.toLocaleString("en-US");
export const shortDate = (iso: string) => new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(new Date(iso));

type Notice = { tone: "success" | "info"; message: string };

export function BillingTab({ initialSummary }: { initialSummary: BillingSummary }) {
  const [summary, setSummary] = useState(initialSummary);
  // Each card's monthly/annual toggle: the current plan shows its own interval, others default to annual.
  const [intervals, setIntervals] = useState<Record<string, BillingInterval>>(() =>
    Object.fromEntries(initialSummary.plans.map((p) => [p.id, p.id === initialSummary.currentPlanId ? initialSummary.interval : "year"])),
  );
  const [pending, setPending] = useState<PendingPlanChange | null>(null);
  const [busy, setBusy] = useState<"plan" | string | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [creditsInfoOpen, setCreditsInfoOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);

  const current = summary.plans.find((p) => p.id === summary.currentPlanId)!;
  const usage = summary.usage;
  const resets = shortDate(usage.periodEndsAt);

  const applySummary = (next: BillingSummary) => {
    setSummary(next);
    setIntervals((prev) => ({ ...prev, [next.currentPlanId]: next.interval }));
    emit(CREDIT_STATUS_UPDATED);
  };

  const confirmPlanChange = async () => {
    if (!pending) return;
    setBusy("plan");
    try {
      const next = await sendJson<BillingSummary>("/api/billing/plan", "POST", { planId: pending.plan.id, interval: pending.interval });
      applySummary(next);
      setNotice({
        tone: "success",
        message: `You're now on ${pending.plan.name} with ${intervalLabel(pending.interval).toLowerCase()} billing. Your limit is ${fmt(next.usage.creditLimit)} credits this period. Nothing was charged.`,
      });
      setPending(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "We couldn't update your plan.");
    } finally {
      setBusy(null);
    }
  };

  const buyPack = async (packId: string) => {
    setBusy(packId);
    try {
      const res = await sendJson<{ credits: number; summary: BillingSummary }>("/api/billing/credit-pack", "POST", { packId });
      applySummary(res.summary);
      setNotice({
        tone: "success",
        message: `${fmt(res.credits)} credits added to this billing period. Recorded in your local ledger, no charge.`,
      });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't add credits");
    } finally {
      setBusy(null);
    }
  };

  const showAnnualOffer = summary.interval === "month" && current.annualPrice > 0;

  return (
    <div className="space-y-6">
      <div className="brand-accent-blue-panel flex items-start gap-3 rounded-xl border p-4 text-sm">
        <Info className="mt-0.5 size-4 flex-shrink-0 text-accent-blue-text" />
        <p>
          <span className="font-semibold">Local billing.</span> {APP_NAME} has no payment processor. Switching plans or adding credits
          updates a ledger on this Mac and sets your Chat credit limit. Nothing is ever charged.
        </p>
      </div>

      {notice && (
        <div
          role="status"
          className={cn(
            "rounded-xl border p-4 text-sm",
            notice.tone === "success"
              ? "border-green-200 bg-green-50 text-green-800 dark:border-green-900/40 dark:bg-green-900/20 dark:text-green-200"
              : "border-stroke bg-gray-50 text-dark dark:border-white/10 dark:bg-white/5 dark:text-white",
          )}
        >
          {notice.message}
        </div>
      )}

      <SettingsCard title="Current Subscription" titleClassName="mb-3">
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <span className="inline-flex rounded-full bg-[#e5e9ea] px-4 py-2 text-sm font-medium text-dark dark:bg-white/10 dark:text-white">
            {current.name} · {intervalLabel(summary.interval)} billing
          </span>
          <span className="text-sm text-dark-5">{priceLabel(current, summary.interval)}, local plan</span>
        </div>
        {showAnnualOffer && (
          <div className="rounded-xl border border-primary/20 bg-primary/5 p-4 dark:border-sky-400/30 dark:bg-sky-400/10">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-sm font-medium text-dark dark:text-white">Save ${current.yearlySavings}/year with annual billing.</p>
                <p className="mt-1 text-sm text-dark-5">
                  Switch to ${current.annualPrice}/year instead of paying ${12 * current.monthlyPrice}/year monthly.
                </p>
              </div>
              <Button
                variant="outline"
                size="lg"
                className="w-full justify-center px-6 sm:w-auto"
                disabled={!!busy}
                onClick={() => {
                  setIntervals((prev) => ({ ...prev, [current.id]: "year" }));
                  setPending({ plan: current, interval: "year", actionLabel: "Switch to Annual" });
                }}
              >
                Switch to Annual
              </Button>
            </div>
          </div>
        )}
      </SettingsCard>

      <section aria-labelledby="billing-usage-heading" className="rounded-xl border border-stroke bg-white p-6 dark:border-white/10 dark:bg-[#18191c]">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h2 id="billing-usage-heading" className="text-lg font-semibold text-dark dark:text-white">
              Credit usage
            </h2>
            <p className="mt-1 text-sm text-dark-5">
              Credits measure the AI work used in Chat. More involved requests use more credits.{" "}
              <button type="button" onClick={() => setCreditsInfoOpen(true)} className="font-medium text-accent-blue-text hover:underline">
                How credits work
              </button>
            </p>
          </div>
          <span className="inline-flex w-fit rounded-full bg-[#e5e9ea] px-3 py-1 text-sm font-medium text-dark dark:bg-white/10 dark:text-white">
            Resets {resets}
          </span>
        </div>

        <div className="mt-6 space-y-5">
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm text-dark dark:text-white">
                <span className="font-semibold">
                  {fmt(usage.usedCredits)} of {fmt(usage.creditLimit)}
                </span>{" "}
                credits used
              </p>
              <p className="text-sm font-medium text-dark-5">{usage.percentUsed}%</p>
            </div>
            <div
              role="progressbar"
              aria-label="Credits used"
              aria-valuenow={usage.percentUsed}
              aria-valuemin={0}
              aria-valuemax={100}
              className="h-2 w-full overflow-hidden rounded-full bg-[#e6ebf1] dark:bg-white/10"
            >
              <div
                className={cn(
                  "h-full rounded-full transition-[width]",
                  usage.warningLevel === "exhausted" ? "bg-red-500" : usage.warningLevel === "critical" ? "bg-accent-blue" : "bg-primary dark:bg-sky-500",
                )}
                style={{ width: `${usage.percentUsed}%` }}
              />
            </div>
            {usage.usedCredits === 0 && <p className="text-sm text-dark-5">No credit usage yet this cycle.</p>}
          </div>

          {usage.grantedCredits > 0 && (
            <p className="text-sm text-dark-5">
              Your limit this period includes {fmt(usage.grantedCredits)} one-time credits from packs ({fmt(usage.planCredits)} come with{" "}
              {current.name}).
            </p>
          )}

          {usage.warningLevel !== "none" && (
            <div
              className={cn(
                "rounded-xl border p-4 text-sm",
                usage.warningLevel === "exhausted"
                  ? "border-red-200 bg-red-50 text-red-700 dark:border-red-900/40 dark:bg-red-900/20 dark:text-red-200"
                  : "border-primary/20 bg-primary/5 text-dark dark:border-sky-400/30 dark:bg-sky-400/10 dark:text-white",
              )}
            >
              {usage.warningLevel === "exhausted"
                ? "You've used all included monthly credits. Upgrade your plan or add a credit pack to keep using Chat."
                : usage.warningLevel === "critical"
                  ? `Only ${fmt(usage.creditsRemaining)} monthly credits remain.`
                  : "You've used 80% of your included monthly credits."}
            </div>
          )}

          {summary.creditPacks.length > 0 && (
            <div className="space-y-3">
              <p className="text-sm text-dark-5">
                Add one-time credits to your current billing period (resets {resets}). Unused pack credits don&apos;t roll over to the next
                period.
              </p>
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                {summary.creditPacks.map((pack) => (
                  <Button
                    key={pack.id}
                    variant="outline"
                    size="lg"
                    className="w-full justify-center px-6 sm:w-auto"
                    disabled={!!busy}
                    onClick={() => buyPack(pack.id)}
                  >
                    {busy === pack.id ? "Adding…" : `Add ${fmt(pack.credits)} credits · $${pack.priceUsd}`}
                  </Button>
                ))}
              </div>
              {current.id === "creator" && (
                <p className="text-sm text-dark-5">
                  Buying packs often? Pro includes {fmt(summary.plans.find((p) => p.id === "pro")?.monthlyCredits ?? 3000)} credits a month for $
                  {summary.plans.find((p) => p.id === "pro")?.monthlyPrice ?? 49}/mo, which works out cheaper per credit.
                </p>
              )}
            </div>
          )}
        </div>
      </section>

      <div id="billing-plans" className="grid scroll-mt-6 gap-6 lg:grid-cols-3">
        {summary.plans.map((plan) => (
          <PlanCard
            key={plan.id}
            plan={plan}
            plans={summary.plans}
            interval={intervals[plan.id] ?? "year"}
            currentPlanId={summary.currentPlanId}
            currentInterval={summary.interval}
            disabled={!!busy}
            onToggle={() => setIntervals((prev) => ({ ...prev, [plan.id]: prev[plan.id] === "year" ? "month" : "year" }))}
            onChoose={(actionLabel) => setPending({ plan, interval: intervals[plan.id] ?? "year", actionLabel })}
          />
        ))}
      </div>

      <SettingsCard
        id="billing-management"
        title="Billing Management"
        description="With no payment processor there are no payment methods or invoices. Every plan change and credit pack is listed in the local ledger."
      >
        <Button variant="outline" size="lg" className="px-6" onClick={() => setHistoryOpen(true)}>
          Manage Billing
        </Button>
      </SettingsCard>

      <ConfirmPlanModal
        pending={pending}
        current={current}
        currentInterval={summary.interval}
        busy={busy === "plan"}
        onClose={() => busy !== "plan" && setPending(null)}
        onConfirm={confirmPlanChange}
      />
      <HowCreditsWorkModal open={creditsInfoOpen} onClose={() => setCreditsInfoOpen(false)} usage={usage} />
      <BillingHistoryModal open={historyOpen} onClose={() => setHistoryOpen(false)} history={summary.history} />
    </div>
  );
}

function PlanCard({
  plan,
  plans,
  interval,
  currentPlanId,
  currentInterval,
  disabled,
  onToggle,
  onChoose,
}: {
  plan: Plan;
  plans: Plan[];
  interval: BillingInterval;
  currentPlanId: string;
  currentInterval: BillingInterval;
  disabled: boolean;
  onToggle: () => void;
  onChoose: (actionLabel: string) => void;
}) {
  const isCurrentPlan = plan.id === currentPlanId;
  const isCurrentPrice = isCurrentPlan && interval === currentInterval;
  const rank = (id: string) => PLAN_RANK[id] ?? 0;
  const actionLabel = isCurrentPlan
    ? `Switch to ${intervalLabel(interval)}`
    : rank(plan.id) > rank(currentPlanId)
      ? `Upgrade to ${plan.name}`
      : `Switch to ${plan.name}`;
  const badge = isCurrentPrice
    ? null
    : isCurrentPlan && currentInterval === "month" && interval === "year"
      ? "Best value"
      : rank(plan.id) === rank(currentPlanId) + 1 && currentInterval === "year"
        ? "Recommended"
        : null;
  const previous = plans.find((p) => p.id === plan.includesPrevious);

  return (
    <div
      className={cn(
        "flex flex-col rounded-xl border bg-white p-6 dark:bg-[#18191c]",
        isCurrentPrice ? "border-primary shadow-sm dark:border-sky-400" : "border-stroke dark:border-white/10",
        badge && "shadow-sm",
      )}
    >
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <h3 className="text-xl font-bold text-dark dark:text-white">{plan.name}</h3>
        {isCurrentPrice && <span className="brand-accent-blue-chip inline-flex rounded-full px-2 py-0.5 text-xs font-medium">Current</span>}
        {badge && <span className="brand-accent-chip inline-flex rounded-full px-2 py-0.5 text-xs font-medium">{badge}</span>}
      </div>
      <p className="min-h-[40px] text-sm text-dark-5">{plan.description}</p>
      <div className="mt-6">
        <div className="flex items-baseline">
          <span className="text-4xl font-bold text-dark dark:text-white">
            ${interval === "year" ? plan.monthlyEquivalent : plan.monthlyPrice}
          </span>
          <span className="ml-1 text-dark-5">/mo</span>
        </div>
        <div className="mt-1 h-5">{interval === "year" && <p className="text-sm text-dark-5">${plan.annualPrice} billed yearly</p>}</div>
      </div>
      {plan.annualPrice > 0 && (
        <div className="mt-6 flex items-center gap-3">
          <Switch checked={interval === "year"} onChange={onToggle} label="Use annual billing" />
          <button type="button" onClick={onToggle} className="text-sm text-dark-5">
            Billed yearly <span className="font-medium text-green-600 dark:text-green-400">(Save ${plan.yearlySavings})</span>
          </button>
        </div>
      )}
      <div className="mt-6">
        {isCurrentPrice ? (
          <div className="flex h-[42px] items-center justify-center rounded-lg border border-stroke bg-gray-50 text-sm font-medium text-dark dark:border-white/10 dark:bg-white/5 dark:text-white">
            Current Plan
          </div>
        ) : (
          <Button size="lg" className="h-[52px] w-full justify-center text-base" disabled={disabled} onClick={() => onChoose(actionLabel)}>
            {actionLabel}
          </Button>
        )}
      </div>
      <hr className="my-8 border-stroke dark:border-white/10" />
      <div className="flex-1">
        <p className="mb-4 text-sm font-semibold text-dark dark:text-white">
          {previous ? `Includes everything in ${previous.name}, plus:` : "Includes:"}
        </p>
        <ul className="space-y-3">
          <Feature>
            <span className="font-semibold">{plan.maxChannels}</span> YouTube channels
          </Feature>
          <Feature>
            <span className="font-semibold">{plan.maxTeamMembers}</span> team members
          </Feature>
          <Feature>
            <span className="font-semibold">{fmt(plan.monthlyCredits)}</span> credits/mo
          </Feature>
          {plan.features.map((f) => (
            <Feature key={f}>{f}</Feature>
          ))}
        </ul>
      </div>
    </div>
  );
}

function Feature({ children }: { children: ReactNode }) {
  return (
    <li className="flex items-start gap-3">
      <svg className="mt-0.5 size-4 flex-shrink-0 text-accent-blue" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
        <path
          fillRule="evenodd"
          d="M16.7 4.15a.75.75 0 0 1 .15 1.05l-8 10.5a.75.75 0 0 1-1.13.08l-4.5-4.5a.75.75 0 1 1 1.06-1.06l3.9 3.89 7.47-9.81a.75.75 0 0 1 1.05-.15Z"
          clipRule="evenodd"
        />
      </svg>
      <span className="text-sm text-dark dark:text-white">{children}</span>
    </li>
  );
}
