import type { Lead, Prisma } from "@prisma/client";
import {
  getConversationCompletion,
  type ChatMessage,
} from "@/lib/ai/client";
import { parseAiResponse } from "@/lib/ai/schema";
import { validateReply } from "@/lib/ai/validate-reply";
import { buildSystemPrompt, PROMPT_VERSION } from "@/lib/ai/system-prompt";
import { computeLeadUpdates, detectFactConflicts } from "@/lib/conversation/apply-facts";
import { determineNextStep, type NextStep } from "@/lib/conversation/determine-next-action";
import { deRepeatReply } from "@/lib/conversation/anti-repeat";
import { matchFaq } from "@/lib/conversation/faq";
import { detectForeignCurrency } from "@/lib/conversation/currency";
import { env } from "@/lib/env";

// Core inbound pipeline (spec §10): call OpenAI once, validate the structured
// facts + reply, decide the next allowed step ourselves, and return everything
// the route needs to persist and send. The model never controls flow or writes.

export type ProcessResult = {
  reply: string;
  leadUpdates: Prisma.LeadUpdateInput;
  nextStage: string;
  needsHumanReview: boolean;
  riskLevel: number;
  riskFlags: string[];
  intent: string | null;
  promptVersion: string;
  model: string;
  /** True if OpenAI failed or returned unparseable JSON (caller may log it). */
  aiError: boolean;
  // Booking signals for the route's calendar step (Phase 4). The route owns the
  // calendar I/O so this module stays free of side effects beyond OpenAI.
  readyForBooking: boolean;
  availability: { date: string | null; earliestTime: string | null };
  selectedSlotStart: string | null;
  // Review notes the route should log as system_events (fact conflicts, foreign
  // currency, etc.) — surfaced so contradictions/ambiguities aren't silent.
  notes: { type: string; detail: Record<string, unknown> }[];
};

// Phase-6 wording pending Raf sign-off — neutral, no invented emergency/medical
// /legal instructions (spec §20).
const SAFE_HOLD_REPLY =
  "Thank you for sharing that with me. I'm passing this to a member of Raf's team so the right person can support you, and they'll be in touch.";

function fallbackReply(step: NextStep, customerQuestion: string | null): string {
  const faq = matchFaq(customerQuestion);
  if (faq) return faq.answer;

  switch (step.action) {
    case "ESCALATE_HUMAN":
      return SAFE_HOLD_REPLY;
    case "PROPOSE_CALLBACK":
      return "From what you've told me, it would help to speak with one of Raf's team. Would you like me to arrange a callback?";
    case "COLLECT_AVAILABILITY":
      return "Great — when would generally suit you for a call? A day and rough time is fine.";
    case "CONTINUE":
      return "Thanks — is there anything else I can help with before your call?";
    case "ASK_FIELD":
    default:
      return step.askField?.question ?? "Could you tell me a little more about your situation?";
  }
}

function mergeLead(lead: Lead, updates: Prisma.LeadUpdateInput): Lead {
  return { ...lead, ...(updates as Partial<Lead>) };
}

function dedupe(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
}

export async function processInboundMessage(
  lead: Lead,
  history: ChatMessage[]
): Promise<ProcessResult> {
  const model = env.openai.model;
  // Guide the model using the state BEFORE this message's facts are applied.
  const preStep = determineNextStep(lead, 0);
  const system = buildSystemPrompt(lead, preStep);

  let raw = "";
  let aiError = false;
  try {
    raw = await getConversationCompletion([
      { role: "system", content: system },
      ...history,
    ]);
  } catch {
    aiError = true;
  }

  const ai = aiError ? null : parseAiResponse(raw);

  // OpenAI failed or returned invalid JSON → safe fallback, keep progress.
  if (!ai) {
    return {
      reply: fallbackReply(preStep, null),
      leadUpdates: { conversationStage: preStep.stage },
      nextStage: preStep.stage,
      needsHumanReview: false,
      riskLevel: 0,
      riskFlags: [],
      intent: null,
      promptVersion: PROMPT_VERSION,
      model,
      aiError: true,
      readyForBooking: false,
      availability: { date: null, earliestTime: null },
      selectedSlotStart: null,
      notes: [],
    };
  }

  const correctedFields = ai.corrections.map((c) => c.field);
  const leadUpdates = computeLeadUpdates(lead, ai.facts, correctedFields);
  const mergedLead = mergeLead(lead, leadUpdates);

  const lastUserMessage =
    [...history].reverse().find((m) => m.role === "user")?.content ?? "";

  // Review notes: contradictions kept-but-flagged, and foreign-currency amounts
  // (stored as a plain number but displayed as GBP). The route logs these.
  const notes: { type: string; detail: Record<string, unknown> }[] = [];
  for (const conflict of detectFactConflicts(lead, ai.facts, correctedFields)) {
    notes.push({ type: "fact_conflict", detail: { ...conflict } });
  }
  const foreignCurrency = detectForeignCurrency(lastUserMessage);
  if (foreignCurrency && ai.facts.estimatedDebt != null) {
    notes.push({
      type: "currency_note",
      detail: { symbol: foreignCurrency, storedValue: ai.facts.estimatedDebt },
    });
  }

  const postStep = determineNextStep(mergedLead, ai.riskLevel);
  leadUpdates.conversationStage = postStep.stage;

  // Escalation can be driven by this message's risk OR a vulnerability already
  // on the lead (e.g. the keyword pre-scan), so key off the resolved step.
  const escalated = postStep.action === "ESCALATE_HUMAN";

  if (ai.riskLevel >= 1) {
    leadUpdates.vulnerabilityLevel = Math.max(lead.vulnerabilityLevel, ai.riskLevel);
    leadUpdates.vulnerabilityFlags = dedupe([
      ...lead.vulnerabilityFlags,
      ...ai.riskFlags,
    ]);
  }
  if (escalated) {
    leadUpdates.status = "NEEDS_REVIEW";
  }

  // Decide the reply: trust the model's wording only if it passes validation.
  let reply = ai.reply.trim();
  if (postStep.action === "ESCALATE_HUMAN") {
    // Even in escalation, block prohibited claims; otherwise use the safe hold.
    const check = validateReply(reply, mergedLead);
    if (!reply || !check.ok) reply = SAFE_HOLD_REPLY;
  } else {
    // Approved FAQ (spec §18): if the customer asked one of the approved
    // questions, answer with the EXACT approved wording — never the model's
    // paraphrase. Match the AI-extracted question first, then the raw message.
    const faq = matchFaq(ai.customerQuestion) ?? matchFaq(lastUserMessage);
    if (faq) {
      reply = faq.answer;
    } else {
      const check = validateReply(reply, mergedLead);
      if (!check.ok) reply = fallbackReply(postStep, ai.customerQuestion);
      // Never send the exact same message twice in a row (avoids the "same reply
      // to everything" loop when the customer gives non-answers).
      const lastBot =
        [...history].reverse().find((m) => m.role === "assistant")?.content ?? "";
      reply = deRepeatReply(reply, lastBot, postStep, mergedLead.preferredName);
    }
  }

  return {
    reply,
    leadUpdates,
    nextStage: postStep.stage,
    needsHumanReview: escalated,
    riskLevel: ai.riskLevel,
    riskFlags: ai.riskFlags,
    intent: ai.intent,
    promptVersion: PROMPT_VERSION,
    model,
    aiError: false,
    // The route should attempt calendar work only when we've reached the
    // availability step (details + consent done, nothing booked yet).
    readyForBooking: postStep.action === "COLLECT_AVAILABILITY",
    availability: ai.availability,
    selectedSlotStart: ai.selectedSlotStart,
    notes,
  };
}
