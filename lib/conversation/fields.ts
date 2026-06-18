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
    kind: "stringArray",
  },
  {
    key: "estimatedDebt",
    label: "approximate total debt",
    question: "Roughly what's the total amount you owe across everything?",
    kind: "number",
  },
  {
    key: "creditorCount",
    label: "number of creditors",
    question: "Roughly how many different organisations are involved?",
    kind: "number",
  },
  {
    key: "monthlyPayment",
    label: "monthly debt payments",
    question: "Roughly how much are you paying towards these debts each month?",
    kind: "number",
  },
  {
    key: "region",
    label: "UK location",
    question: "Whereabouts in the UK are you based?",
    kind: "string",
  },
  {
    key: "housingStatus",
    label: "housing status",
    question: "What's your housing situation — renting, a mortgage, or something else?",
    kind: "string",
  },
  {
    key: "employmentStatus",
    label: "employment or income",
    question: "What's your income situation at the moment — working, benefits, or otherwise?",
    kind: "string",
  },
  {
    key: "dependantSummary",
    label: "dependants",
    question: "Do you have any dependants, such as children living with you?",
    kind: "string",
  },
  {
    key: "motivation",
    label: "reason for seeking help",
    question: "What's prompted you to look for help with this now?",
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
