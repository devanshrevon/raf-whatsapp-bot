import type { Lead } from "@prisma/client";

// Single source of truth for the lead information the bot collects (spec §7).
// known-fields, apply-facts, determine-next-action and the system prompt all
// derive from this list so questions, ordering and storage stay in sync.

export type DataFieldKey =
  | "preferredName"
  | "debtTypes"
  | "estimatedDebt"
  | "creditorCount"
  | "monthlyPayment"
  | "region"
  | "housingStatus"
  | "employmentStatus"
  | "dependantSummary"
  | "motivation";

export type DataField = {
  key: DataFieldKey;
  label: string;
  /** Plain-UK-English question used for the safe fallback and prompt guidance. */
  question: string;
  /** A short example, used to rephrase a question if the bot would repeat itself. */
  example?: string;
  kind: "string" | "number" | "stringArray";
};

// Order matters: this is the order the bot prefers to ask in.
export const DATA_FIELDS: readonly DataField[] = [
  {
    key: "preferredName",
    label: "preferred name",
    question: "What name would you like me to use?",
    kind: "string",
  },
  {
    key: "debtTypes",
    label: "main debt types",
    question: "Which debts are causing you the most concern right now?",
    example: "credit cards, a personal loan, council tax",
    kind: "stringArray",
  },
  {
    key: "estimatedDebt",
    label: "approximate total debt",
    question: "Roughly what's the total amount you owe across everything?",
    example: "around £15,000",
    kind: "number",
  },
  {
    key: "creditorCount",
    label: "number of creditors",
    question: "Roughly how many different organisations are involved?",
    example: "about 3 or 4",
    kind: "number",
  },
  {
    key: "monthlyPayment",
    label: "monthly debt payments",
    question: "Roughly how much are you paying towards these debts each month?",
    example: "around £200 a month",
    kind: "number",
  },
  {
    key: "region",
    label: "UK location",
    question: "Whereabouts in the UK are you based?",
    example: "Manchester, Cardiff, London",
    kind: "string",
  },
  {
    key: "housingStatus",
    label: "housing status",
    question: "What's your housing situation — renting, a mortgage, or something else?",
    example: "renting, own with a mortgage, or living with family",
    kind: "string",
  },
  {
    key: "employmentStatus",
    label: "employment or income",
    question: "What's your income situation at the moment — working, benefits, or otherwise?",
    example: "working full-time, self-employed, or on benefits",
    kind: "string",
  },
  {
    key: "dependantSummary",
    label: "dependants",
    question: "Do you have any dependants, such as children living with you?",
    example: "two children, or none",
    kind: "string",
  },
  {
    key: "motivation",
    label: "reason for seeking help",
    question: "What's prompted you to look for help with this now?",
    example: "payments have become hard to manage",
    kind: "string",
  },
] as const;

/** Is a single collectable field already populated on the lead? */
export function isFieldKnown(lead: Lead, key: DataFieldKey): boolean {
  const value = lead[key];
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "number") return Number.isFinite(value); // 0 is a valid answer
  return typeof value === "string" ? value.trim().length > 0 : value != null;
}
