// HookLab's plan and credit-pack catalogue for the local billing ledger. Edit these to
// set your own tiers; nothing is charged (see docs/PROJECTS-AND-SETTINGS.md).
// monthly price = (annualTotal + annualSavings) / 12.

export const DEFAULT_PLANS = [
  {
    id: "creator",
    name: "Creator",
    description: "For creators who want to get started with the AI chat.",
    monthlyPrice: 19,
    annualTotal: 171,
    annualSavings: 57,
    channels: 5,
    teamMembers: 3,
    creditsPerMonth: 500,
    features: ["Following", "Projects", "Studio", "My Channel", "Bookmarks"],
    includesPrevious: null,
  },
  {
    id: "pro",
    name: "Pro",
    description: "For serious creators who run their channel like a business.",
    monthlyPrice: 49,
    annualTotal: 441,
    annualSavings: 147,
    channels: 10,
    teamMembers: 5,
    creditsPerMonth: 3000,
    features: ["Outliers", "Feedback"],
    includesPrevious: "creator",
  },
  {
    id: "agency",
    name: "Agency",
    description: "For teams who need more channels and higher usage.",
    monthlyPrice: 99,
    annualTotal: 891,
    annualSavings: 297,
    channels: 20,
    teamMembers: 10,
    creditsPerMonth: 7000,
    features: ["Feedback"],
    includesPrevious: "pro",
  },
];

export const DEFAULT_CREDIT_PACKS = [
  { id: "pack_250", credits: 250, price: 5, note: "One-time credits for the current billing period; unused pack credits don't roll over." },
  { id: "pack_550", credits: 550, price: 10, note: "One-time credits for the current billing period; unused pack credits don't roll over." },
];
