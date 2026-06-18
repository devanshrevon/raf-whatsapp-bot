import type { Lead } from "@prisma/client";
import { missingDataFields } from "@/lib/conversation/known-fields";
import type { DataField } from "@/lib/conversation/fields";

// Explicit conversation state machine (spec §9). The APPLICATION decides what
// happens next — never the LLM. Given the (already fact-updated) lead and the
// AI's risk read, this returns the next stage + the action the reply should aim
// at. Note: slot offering and booking (OFFERING_SLOTS onward) are Phase 4, and
// follow-up scheduling is Phase 5 (owned by the intern).

export type NextAction =
  | "ESCALATE_HUMAN"
  | "ASK_FIELD"
  | "PROPOSE_CALLBACK"
  | "COLLECT_AVAILABILITY";

export type ConversationStage =
  | "NEW"
  | "DISCOVERING_SITUATION"
  | "COLLECTING_DETAILS"
  | "READY_FOR_CALLBACK"
  | "COLLECTING_AVAILABILITY"
  | "NEEDS_HUMAN_REVIEW";

export type NextStep = {
  stage: ConversationStage;
  action: NextAction;
  /** The field to ask about, when action is ASK_FIELD. */
  askField: DataField | null;
};

export function determineNextStep(lead: Lead, riskLevel: number): NextStep {
  // Serious / vulnerable situations stop ordinary progression (spec §20).
  if (riskLevel >= 2) {
    return { stage: "NEEDS_HUMAN_REVIEW", action: "ESCALATE_HUMAN", askField: null };
  }

  const missing = missingDataFields(lead);

  if (missing.length > 0) {
    // First contact (no name yet) is the discovery opener; otherwise we're
    // steadily collecting details.
    const stage: ConversationStage = lead.preferredName
      ? "COLLECTING_DETAILS"
      : "DISCOVERING_SITUATION";
    return { stage, action: "ASK_FIELD", askField: missing[0] };
  }

  // All details collected — get explicit consent before booking.
  if (!lead.callbackConsent) {
    return { stage: "READY_FOR_CALLBACK", action: "PROPOSE_CALLBACK", askField: null };
  }

  // Details + consent done → start gathering availability (Phase 4 takes over
  // the real free/busy check and slot offering from here).
  return { stage: "COLLECTING_AVAILABILITY", action: "COLLECT_AVAILABILITY", askField: null };
}
