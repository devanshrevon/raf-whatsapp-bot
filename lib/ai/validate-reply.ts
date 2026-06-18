import type { Lead } from "@prisma/client";
import { checkProhibitedClaims } from "@/lib/safety/guardrails";
import { isFieldKnown } from "@/lib/conversation/fields";

// Validate a proposed reply before sending (spec §19.2). On failure the caller
// uses a safe fallback. This covers the structural/safety checks that don't
// depend on Phase 4 (no invented appointment) or full Phase 6 vulnerability
// wording — those are layered in later.

const MAX_WORDS = 90;

// If the customer already gave a field, the reply shouldn't ask for it again.
const REASK_PATTERNS: { key: Parameters<typeof isFieldKnown>[1]; pattern: RegExp }[] = [
  { key: "preferredName", pattern: /\bwhat('?s| is) your name|what name would you like\b/i },
  { key: "estimatedDebt", pattern: /\b(how much|what).{0,20}(owe|total (amount|debt|balance))\b/i },
  { key: "monthlyPayment", pattern: /\bhow much.{0,20}(pay|paying).{0,20}(month|monthly)\b/i },
  { key: "region", pattern: /\bwhere.{0,15}(based|live|in the uk)\b/i },
  { key: "creditorCount", pattern: /\bhow many.{0,20}(creditors|organisations|companies)\b/i },
];

export type ReplyValidation = { ok: boolean; reasons: string[] };

export function validateReply(reply: string, lead: Lead): ReplyValidation {
  const reasons: string[] = [];
  const text = reply.trim();

  if (!text) reasons.push("empty");

  const words = text.split(/\s+/).filter(Boolean).length;
  if (words > MAX_WORDS) reasons.push("too_long");

  // One main question at a time.
  const questionCount = (text.match(/\?/g) ?? []).length;
  if (questionCount > 1) reasons.push("multiple_questions");

  // Prohibited claims (spec §19.1).
  const claims = checkProhibitedClaims(text);
  if (!claims.ok) reasons.push(...claims.flags.map((f) => `claim:${f}`));

  // Don't re-ask a known field (spec §19.1).
  for (const { key, pattern } of REASK_PATTERNS) {
    if (isFieldKnown(lead, key) && pattern.test(text)) {
      reasons.push(`reask:${key}`);
    }
  }

  return { ok: reasons.length === 0, reasons };
}
