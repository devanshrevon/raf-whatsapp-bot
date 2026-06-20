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
    // Never store preferredName when the lead is brand-new (stage "NEW"): the
    // bot hasn't asked for it yet, so any value the model extracts from the
    // opening message (e.g. "hey") is speculative and must not be persisted.
    if (key === "preferredName" && lead.conversationStage === "NEW") continue;
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

export type FactConflict = { field: string; stored: string; incoming: string };

/**
 * Find facts that CONTRADICT an already-stored value without the customer
 * explicitly correcting them (e.g. stored housing "renting", new message says
 * "mortgage", but the AI didn't flag a correction). computeLeadUpdates keeps the
 * original value in this case; this surfaces the contradiction so the caller can
 * flag it for review instead of silently dropping the new fact (spec area B).
 */
export function detectFactConflicts(
  lead: Lead,
  facts: ExtractedFacts,
  correctedFields: string[] = []
): FactConflict[] {
  const corrected = new Set(correctedFields);
  const conflicts: FactConflict[] = [];

  const consider = (field: string, stored: unknown, incoming: unknown) => {
    if (incoming == null || corrected.has(field)) return;
    if (stored == null || (typeof stored === "string" && stored.trim() === "")) return;
    if (String(stored).trim().toLowerCase() !== String(incoming).trim().toLowerCase()) {
      conflicts.push({ field, stored: String(stored), incoming: String(incoming) });
    }
  };

  for (const key of STRING_FIELDS) consider(key, lead[key], facts[key]);
  for (const key of NUMBER_FIELDS) consider(key, lead[key], facts[key]);

  return conflicts;
}
