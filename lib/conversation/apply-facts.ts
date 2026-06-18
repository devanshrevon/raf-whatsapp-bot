import type { Lead, Prisma } from "@prisma/client";
import type { ExtractedFacts } from "@/lib/ai/schema";

// Merge AI-extracted facts into a lead, producing a Prisma update payload.
// Rules (spec §12, §13.3):
//  - Never overwrite an existing value UNLESS the customer corrected it.
//  - Arrays (debtTypes) union new values in; a correction replaces them.
//  - Consent only moves false -> true here (opt-out is handled elsewhere).

const STRING_FIELDS = [
  "preferredName",
  "region",
  "housingStatus",
  "employmentStatus",
  "dependantSummary",
  "motivation",
] as const;

const NUMBER_FIELDS = ["estimatedDebt", "creditorCount", "monthlyPayment"] as const;

const DISCLOSURE_FIELDS = [
  "paymentArrears",
  "bailiffInvolvement",
  "courtAction",
  "carFinanceConcern",
  "recentIncomeLoss",
  "relationshipBreakdown",
  "businessDebtConcern",
] as const;

function isEmptyString(value: unknown): boolean {
  return value == null || (typeof value === "string" && value.trim() === "");
}

export function computeLeadUpdates(
  lead: Lead,
  facts: ExtractedFacts,
  correctedFields: string[] = []
): Prisma.LeadUpdateInput {
  const corrected = new Set(correctedFields);
  const updates: Prisma.LeadUpdateInput = {};

  for (const key of STRING_FIELDS) {
    const incoming = facts[key];
    if (incoming != null && (isEmptyString(lead[key]) || corrected.has(key))) {
      updates[key] = incoming;
    }
  }

  for (const key of NUMBER_FIELDS) {
    const incoming = facts[key];
    if (incoming != null && (lead[key] == null || corrected.has(key))) {
      updates[key] = incoming;
    }
  }

  if (facts.debtTypes.length > 0) {
    if (corrected.has("debtTypes") || lead.debtTypes.length === 0) {
      updates.debtTypes = dedupe(facts.debtTypes);
    } else {
      updates.debtTypes = dedupe([...lead.debtTypes, ...facts.debtTypes]);
    }
  }

  if (facts.callbackConsent === true && !lead.callbackConsent) {
    updates.callbackConsent = true;
  }

  for (const key of DISCLOSURE_FIELDS) {
    const incoming = facts[key];
    if (incoming != null && (lead[key] == null || corrected.has(key))) {
      updates[key] = incoming;
    }
  }

  return updates;
}

function dedupe(values: string[]): string[] {
  return Array.from(new Set(values.map((v) => v.trim()).filter(Boolean)));
}
