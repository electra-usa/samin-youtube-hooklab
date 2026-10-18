"use client";

import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { APP_NAME } from "@/lib/brand";
import {
  PLAN_RANK,
  intervalLabel,
  planPitch,
  priceLabel,
  type BillingInterval,
  type CreditUsage,
  type LedgerEntry,
  type Plan,
} from "@/lib/billing/plans";

export type PendingPlanChange = { plan: Plan; interval: BillingInterval; actionLabel: string };

const fmt = (n: number) => n.toLocaleString("en-US");
const longDate = (iso: string) => new Intl.DateTimeFormat("en-US", { month: "long", day: "numeric", year: "numeric" }).format(new Date(iso));

export function ConfirmPlanModal({
  pending,
  current,
  currentInterval,
  busy,
  onClose,
  onConfirm,
}: {
  pending: PendingPlanChange | null;
  current: Plan;
  currentInterval: BillingInterval;
  busy: boolean;
  onClose: () => void;
  onConfirm: () => void;
}) {
  if (!pending) return null;
  const { plan, interval } = pending;
  const downgrade =
    (PLAN_RANK[plan.id] ?? 0) < (PLAN_RANK[current.id] ?? 0) || (plan.id === current.id && currentInterval === "year" && interval === "month");
  return (
    <Modal
      open
      onClose={onClose}
      title="Confirm plan change"
      footer={
        <>
          <Button variant="soft" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={onConfirm} disabled={busy}>
            {busy ? "Updating…" : pending.actionLabel}
          </Button>
        </>
      }
    >
      <p className="mb-5 text-sm text-dark-5">Review your current subscription and the new plan before continuing.</p>
      <div className="space-y-4">
        <div className="rounded-xl border border-stroke bg-gray-50 p-4 dark:border-white/10 dark:bg-white/5">
          <p className="text-xs font-medium uppercase tracking-wide text-dark-5">Current subscription</p>
          <p className="mt-2 text-base font-semibold text-dark dark:text-white">
            {current.name}, {intervalLabel(currentInterval)} billing
          </p>
          <p className="mt-1 text-sm text-dark-5">{planPitch(current)}</p>
          <p className="mt-1 text-sm font-semibold text-dark dark:text-white">{priceLabel(current, currentInterval)}</p>
        </div>
        <div className="rounded-xl border border-primary bg-primary/5 p-4 dark:border-sky-400 dark:bg-sky-400/10">
          <p className="text-xs font-medium uppercase tracking-wide text-primary dark:text-sky-200">New plan</p>
          <p className="mt-2 text-base font-semibold text-dark dark:text-white">
            {plan.name}, {intervalLabel(interval)} billing
          </p>
          <p className="mt-1 text-sm text-dark-5">{planPitch(plan)}</p>
          <p className="mt-1 text-sm font-semibold text-dark dark:text-white">{priceLabel(plan, interval)}</p>
        </div>
      </div>
      <p className="mt-5 text-sm text-dark-5">
        {downgrade ? "The change applies right away" : "Your new plan starts right away"}: your monthly allowance becomes{" "}
        {fmt(plan.monthlyCredits)} credits (plus any packs added this period). {APP_NAME} records this locally and takes no payment.
      </p>
    </Modal>
  );
}

const CREDIT_KINDS = [
  { title: "Quick help", description: "Short answers and focused feedback use the fewest credits." },
  { title: "Creative work", description: "Generating ideas, titles, angles or thumbnail text takes more AI work." },
  { title: "Deep analysis", description: "Research, strategy and longer breakdowns use the most credits." },
  { title: "Attachments", description: "Reading screenshots or transcripts adds to a request's cost." },
];

export function HowCreditsWorkModal({ open, onClose, usage }: { open: boolean; onClose: () => void; usage: CreditUsage }) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="How credits work"
      footer={
        <Button size="sm" onClick={onClose}>
          Got it
        </Button>
      }
    >
      <p className="text-sm text-dark-5">
        Credits are how {APP_NAME} measures the AI work behind each Chat reply. The amount depends on what you ask for.
      </p>
      <div className="mt-5 space-y-3">
        {CREDIT_KINDS.map((k) => (
          <div key={k.title} className="flex gap-3 rounded-xl border border-stroke p-3 dark:border-white/10">
            <span className="mt-1.5 size-2 flex-shrink-0 rounded-full bg-accent-blue" aria-hidden="true" />
            <div>
              <p className="text-sm font-semibold text-dark dark:text-white">{k.title}</p>
              <p className="mt-0.5 text-sm text-dark-5">{k.description}</p>
            </div>
          </div>
        ))}
      </div>
      <div className="mt-5 rounded-xl bg-[#e5e9ea] p-4 text-sm dark:bg-white/10">
        <p className="font-semibold text-dark dark:text-white">
          {fmt(usage.creditsRemaining)} of {fmt(usage.creditLimit)} credits remaining
        </p>
        <p className="mt-1 text-dark-5">
          Your allowance resets on {longDate(usage.periodEndsAt)}. You can check your usage here in Billing at any time.
        </p>
      </div>
    </Modal>
  );
}

export function BillingHistoryModal({ open, onClose, history }: { open: boolean; onClose: () => void; history: LedgerEntry[] }) {
  return (
    <Modal open={open} onClose={onClose} title="Local billing history" size="lg">
      <p className="mb-4 text-sm text-dark-5">
        Plan changes and credit packs recorded on this Mac. Amounts show the list price; nothing was charged.
      </p>
      {history.length === 0 ? (
        <p className="rounded-lg bg-gray-50 p-4 text-center text-sm text-dark-5 dark:bg-white/5">
          No changes yet. Your plan came from your account export.
        </p>
      ) : (
        <ul className="divide-y divide-stroke rounded-lg border border-stroke dark:divide-white/10 dark:border-white/10">
          {history.map((h) => (
            <li key={h.id} className="flex items-start justify-between gap-4 px-4 py-3 text-sm">
              <div className="min-w-0">
                <p className="font-medium text-dark dark:text-white">{h.description}</p>
                <p className="text-xs text-dark-5">
                  {longDate(h.createdAt)} · {h.kind === "credit_pack" ? `+${fmt(h.credits)} credits` : `${fmt(h.credits)} credits/mo`}
                </p>
              </div>
              <span className="flex-shrink-0 text-dark-5">${h.amountUsd} · not charged</span>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}
