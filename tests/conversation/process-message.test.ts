import { describe, it, expect, vi, beforeEach } from "vitest";
import { processInboundMessage } from "@/lib/ai/process-message";
import { matchFaq } from "@/lib/conversation/faq";
import { makeLead, makeCompleteLead } from "../helpers/lead";

// ── mock the only external dependency ──────────────────────────────────────
vi.mock("@/lib/ai/client", () => ({
  getConversationCompletion: vi.fn(),
}));

import { getConversationCompletion } from "@/lib/ai/client";
const mockAI = getConversationCompletion as ReturnType<typeof vi.fn>;

// ── helpers ─────────────────────────────────────────────────────────────────

function aiJson(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    intent: "OTHER",
    facts: {
      preferredName: null, debtTypes: [], estimatedDebt: null,
      creditorCount: null, monthlyPayment: null, region: null,
      housingStatus: null, employmentStatus: null, dependantSummary: null,
      motivation: null, callbackConsent: null, paymentArrears: null,
      bailiffInvolvement: null, courtAction: null, carFinanceConcern: null,
      recentIncomeLoss: null, relationshipBreakdown: null, businessDebtConcern: null,
    },
    corrections: [],
    customerQuestion: null,
    availability: { date: null, earliestTime: null },
    selectedSlotStart: null,
    riskLevel: 0,
    riskFlags: [],
    suggestedNextAction: "",
    reply: "What name would you like me to use?",
    ...overrides,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ── test suite ───────────────────────────────────────────────────────────────

describe("processInboundMessage — AI error handling", () => {
  it("returns a safe fallback when OpenAI throws", async () => {
    mockAI.mockRejectedValue(new Error("Network error"));
    const result = await processInboundMessage(makeLead(), []);
    expect(result.aiError).toBe(true);
    expect(result.reply).toBeTruthy();
    expect(result.reply.length).toBeGreaterThan(5);
  });

  it("returns a safe fallback when OpenAI returns invalid JSON", async () => {
    mockAI.mockResolvedValue("this is not json {{{");
    const result = await processInboundMessage(makeLead(), []);
    expect(result.aiError).toBe(true);
    expect(result.reply).toBeTruthy();
  });

  it("returns a safe fallback when OpenAI returns an empty string", async () => {
    mockAI.mockResolvedValue("");
    const result = await processInboundMessage(makeLead(), []);
    expect(result.aiError).toBe(true);
    expect(result.reply).toBeTruthy();
  });

  it("does NOT crash on any of the above — always returns a ProcessResult shape", async () => {
    mockAI.mockRejectedValue(new Error("timeout"));
    const result = await processInboundMessage(makeLead(), []);
    expect(result).toHaveProperty("reply");
    expect(result).toHaveProperty("leadUpdates");
    expect(result).toHaveProperty("nextStage");
    expect(result).toHaveProperty("aiError");
    expect(result).toHaveProperty("readyForBooking");
  });
});

describe("processInboundMessage — valid AI responses", () => {
  it("uses the AI reply when it passes validation", async () => {
    mockAI.mockResolvedValue(aiJson({ reply: "Thanks for that. Could you tell me roughly how much you owe?" }));
    const result = await processInboundMessage(makeLead(), []);
    expect(result.aiError).toBe(false);
    expect(result.reply).toBe("Thanks for that. Could you tell me roughly how much you owe?");
  });

  it("extracts a single fact correctly — requires lead past NEW stage", async () => {
    mockAI.mockResolvedValue(aiJson({
      facts: { preferredName: "Louise", debtTypes: [], estimatedDebt: null,
        creditorCount: null, monthlyPayment: null, region: null,
        housingStatus: null, employmentStatus: null, dependantSummary: null,
        motivation: null, callbackConsent: null, paymentArrears: null,
        bailiffInvolvement: null, courtAction: null, carFinanceConcern: null,
        recentIncomeLoss: null, relationshipBreakdown: null, businessDebtConcern: null,
      },
    }));
    // Lead must be past "NEW" stage so the bot has already asked for the name.
    const lead = makeLead({ conversationStage: "DISCOVERING_SITUATION" });
    const result = await processInboundMessage(lead, []);
    expect(result.leadUpdates.preferredName).toBe("Louise");
  });

  it("regression (Bug 2): does NOT store a greeting as preferredName on first contact (stage=NEW)", async () => {
    // A customer opens with "hey" — the model may speculatively extract it as
    // a name, but we must NOT persist it since the bot hasn't asked yet.
    mockAI.mockResolvedValue(aiJson({
      facts: { preferredName: "hey", debtTypes: [], estimatedDebt: null,
        creditorCount: null, monthlyPayment: null, region: null,
        housingStatus: null, employmentStatus: null, dependantSummary: null,
        motivation: null, callbackConsent: null, paymentArrears: null,
        bailiffInvolvement: null, courtAction: null, carFinanceConcern: null,
        recentIncomeLoss: null, relationshipBreakdown: null, businessDebtConcern: null,
      },
      reply: "Hi there! What name would you like me to use?",
    }));
    // Fresh lead — conversationStage is "NEW".
    const result = await processInboundMessage(makeLead(), []);
    expect(result.leadUpdates.preferredName).toBeUndefined();
  });

  it("extracts multiple facts from a single message", async () => {
    mockAI.mockResolvedValue(aiJson({
      facts: {
        preferredName: null, debtTypes: ["council_tax", "rent_arrears"],
        estimatedDebt: 19000, creditorCount: null, monthlyPayment: null,
        region: "Wales", housingStatus: "renting", employmentStatus: "benefits",
        dependantSummary: null, motivation: null, callbackConsent: null,
        paymentArrears: null, bailiffInvolvement: null, courtAction: null,
        carFinanceConcern: null, recentIncomeLoss: null,
        relationshipBreakdown: null, businessDebtConcern: null,
      },
    }));
    const result = await processInboundMessage(makeLead(), []);
    expect(result.leadUpdates.debtTypes).toContain("council_tax");
    expect(result.leadUpdates.debtTypes).toContain("rent_arrears");
    expect(result.leadUpdates.estimatedDebt).toBe(19000);
    expect(result.leadUpdates.region).toBe("Wales");
    expect(result.leadUpdates.housingStatus).toBe("renting");
    expect(result.leadUpdates.employmentStatus).toBe("benefits");
  });

  it("applies corrections — overwrites existing estimatedDebt when corrected", async () => {
    const lead = makeLead({ estimatedDebt: 40000 });
    mockAI.mockResolvedValue(aiJson({
      facts: { preferredName: null, debtTypes: [], estimatedDebt: 31000,
        creditorCount: null, monthlyPayment: null, region: null,
        housingStatus: null, employmentStatus: null, dependantSummary: null,
        motivation: null, callbackConsent: null, paymentArrears: null,
        bailiffInvolvement: null, courtAction: null, carFinanceConcern: null,
        recentIncomeLoss: null, relationshipBreakdown: null, businessDebtConcern: null,
      },
      corrections: ["estimatedDebt"],
    }));
    const result = await processInboundMessage(lead, []);
    expect(result.leadUpdates.estimatedDebt).toBe(31000);
  });

  it("does NOT overwrite estimatedDebt without a correction signal", async () => {
    const lead = makeLead({ estimatedDebt: 40000 });
    mockAI.mockResolvedValue(aiJson({
      facts: { preferredName: null, debtTypes: [], estimatedDebt: 31000,
        creditorCount: null, monthlyPayment: null, region: null,
        housingStatus: null, employmentStatus: null, dependantSummary: null,
        motivation: null, callbackConsent: null, paymentArrears: null,
        bailiffInvolvement: null, courtAction: null, carFinanceConcern: null,
        recentIncomeLoss: null, relationshipBreakdown: null, businessDebtConcern: null,
      },
      corrections: [],
    }));
    const result = await processInboundMessage(lead, []);
    expect(result.leadUpdates.estimatedDebt).toBeUndefined();
  });
});

describe("processInboundMessage — safety guardrails", () => {
  it("blocks a prohibited claim from the AI and substitutes a fallback", async () => {
    mockAI.mockResolvedValue(aiJson({
      reply: "We guarantee your debt will be written off!",
    }));
    const result = await processInboundMessage(makeLead(), []);
    expect(result.reply).not.toContain("guarantee");
    expect(result.reply).not.toContain("written off");
    // Must still return a valid non-empty reply
    expect(result.reply.length).toBeGreaterThan(5);
  });

  it("blocks a reply claiming to be human", async () => {
    mockAI.mockResolvedValue(aiJson({
      reply: "I am a real human debt adviser here to help.",
    }));
    const result = await processInboundMessage(makeLead(), []);
    expect(result.reply).not.toContain("real human");
  });

  it("blocks a reply that re-asks a known field (estimatedDebt)", async () => {
    const lead = makeLead({ estimatedDebt: 14000 });
    mockAI.mockResolvedValue(aiJson({
      reply: "How much do you owe in total?",
    }));
    const result = await processInboundMessage(lead, []);
    // validate-reply should block this and substitute fallback
    expect(result.reply).not.toBe("How much do you owe in total?");
  });
});

describe("processInboundMessage — risk escalation", () => {
  it("sets needsHumanReview=true and status=NEEDS_REVIEW at riskLevel 2", async () => {
    mockAI.mockResolvedValue(aiJson({
      riskLevel: 2,
      riskFlags: ["mental_health"],
      reply: "Thank you for telling me.",
    }));
    const result = await processInboundMessage(makeLead(), []);
    expect(result.needsHumanReview).toBe(true);
    expect(result.riskLevel).toBe(2);
    expect(result.leadUpdates.status).toBe("NEEDS_REVIEW");
    expect(result.leadUpdates.vulnerabilityLevel).toBe(2);
  });

  it("sets needsHumanReview=true at riskLevel 3", async () => {
    mockAI.mockResolvedValue(aiJson({
      riskLevel: 3,
      riskFlags: ["suicidal_ideation"],
      reply: "I am so sorry to hear that.",
    }));
    const result = await processInboundMessage(makeLead(), []);
    expect(result.needsHumanReview).toBe(true);
    expect(result.riskLevel).toBe(3);
    expect(result.leadUpdates.status).toBe("NEEDS_REVIEW");
  });

  it("accumulates vulnerability flags across messages (deduplicated)", async () => {
    const lead = makeLead({ vulnerabilityLevel: 1, vulnerabilityFlags: ["struggling"] });
    mockAI.mockResolvedValue(aiJson({
      riskLevel: 2,
      riskFlags: ["mental_health", "struggling"],
    }));
    const result = await processInboundMessage(lead, []);
    const flags = result.leadUpdates.vulnerabilityFlags as string[];
    expect(flags).toContain("mental_health");
    expect(flags).toContain("struggling");
    // deduplicated — "struggling" appears only once
    expect(flags.filter((f) => f === "struggling").length).toBe(1);
  });

  it("does NOT downgrade vulnerability from 2 to 1", async () => {
    const lead = makeLead({ vulnerabilityLevel: 2 });
    mockAI.mockResolvedValue(aiJson({ riskLevel: 1, riskFlags: ["stressed"] }));
    const result = await processInboundMessage(lead, []);
    // Math.max(2, 1) = 2 — should stay at 2
    expect(result.leadUpdates.vulnerabilityLevel).toBe(2);
  });
});

describe("processInboundMessage — booking signals", () => {
  it("readyForBooking=false when fields are still missing", async () => {
    mockAI.mockResolvedValue(aiJson({ reply: "What name would you like me to use?" }));
    const result = await processInboundMessage(makeLead(), []);
    expect(result.readyForBooking).toBe(false);
  });

  it("readyForBooking=true when all details collected and consent given", async () => {
    const lead = makeCompleteLead({ callbackConsent: true });
    mockAI.mockResolvedValue(aiJson({
      reply: "When would suit you for a call?",
      availability: { date: null, earliestTime: null },
    }));
    const result = await processInboundMessage(lead, []);
    expect(result.readyForBooking).toBe(true);
  });

  it("passes availability signals from AI to caller", async () => {
    const lead = makeCompleteLead({ callbackConsent: true });
    mockAI.mockResolvedValue(aiJson({
      reply: "Let me check what's free.",
      availability: { date: "2026-06-20", earliestTime: "16:30" },
    }));
    const result = await processInboundMessage(lead, []);
    expect(result.availability.date).toBe("2026-06-20");
    expect(result.availability.earliestTime).toBe("16:30");
  });

  it("passes selectedSlotStart from AI to caller", async () => {
    const lead = makeCompleteLead({ callbackConsent: true });
    mockAI.mockResolvedValue(aiJson({
      reply: "Great, booked for 5pm.",
      selectedSlotStart: "2026-06-20T16:00:00.000Z",
    }));
    const result = await processInboundMessage(lead, []);
    expect(result.selectedSlotStart).toBe("2026-06-20T16:00:00.000Z");
  });

  it("regression (Bug 1): availability fields reach the caller when model returns them in COLLECT_AVAILABILITY stage", async () => {
    // In the original bug, the output JSON schema in the system prompt was missing
    // 'availability' and 'selectedSlotStart', so models would often omit them,
    // causing handleBookingTurn to receive null for both and never offer real slots.
    // This test verifies the full pipeline correctly passes them through.
    const lead = makeCompleteLead({ callbackConsent: true });
    mockAI.mockResolvedValue(aiJson({
      reply: "Let me find a time that works.",
      availability: { date: "2026-06-23", earliestTime: "17:00" },
      selectedSlotStart: null,
    }));
    const result = await processInboundMessage(lead, []);
    expect(result.readyForBooking).toBe(true);
    expect(result.availability.date).toBe("2026-06-23");
    expect(result.availability.earliestTime).toBe("17:00");
    expect(result.selectedSlotStart).toBeNull();
  });
});

describe("processInboundMessage — stage transitions", () => {
  it("stage is DISCOVERING_SITUATION on first contact (no name)", async () => {
    mockAI.mockResolvedValue(aiJson({ reply: "Hi! What name would you like me to use?" }));
    const result = await processInboundMessage(makeLead(), []);
    expect(result.nextStage).toBe("DISCOVERING_SITUATION");
  });

  it("stage is COLLECTING_DETAILS once a name is known", async () => {
    const lead = makeLead({ preferredName: "Sam" });
    mockAI.mockResolvedValue(aiJson({ reply: "Which debts are causing you the most concern?" }));
    const result = await processInboundMessage(lead, []);
    expect(result.nextStage).toBe("COLLECTING_DETAILS");
  });

  it("stage is READY_FOR_CALLBACK when all details in but no consent", async () => {
    const lead = makeCompleteLead();
    mockAI.mockResolvedValue(aiJson({ reply: "Would you like to arrange a callback?" }));
    const result = await processInboundMessage(lead, []);
    expect(result.nextStage).toBe("READY_FOR_CALLBACK");
  });

  it("stage is COLLECTING_AVAILABILITY when details + consent present", async () => {
    const lead = makeCompleteLead({ callbackConsent: true });
    mockAI.mockResolvedValue(aiJson({ reply: "When would suit you?" }));
    const result = await processInboundMessage(lead, []);
    expect(result.nextStage).toBe("COLLECTING_AVAILABILITY");
  });

  it("stage is NEEDS_HUMAN_REVIEW at riskLevel 2+ regardless of field completion", async () => {
    const lead = makeCompleteLead({ callbackConsent: true });
    mockAI.mockResolvedValue(aiJson({ riskLevel: 2, reply: "I understand, passing to team." }));
    const result = await processInboundMessage(lead, []);
    expect(result.nextStage).toBe("NEEDS_HUMAN_REVIEW");
  });

  it("does not regress a BOOKED lead back into collection", async () => {
    const lead = makeLead({ conversationStage: "APPOINTMENT_BOOKED" });
    mockAI.mockResolvedValue(aiJson({ reply: "Is there anything else I can help with?" }));
    const result = await processInboundMessage(lead, []);
    expect(result.nextStage).toBe("APPOINTMENT_BOOKED");
  });
});

describe("processInboundMessage — approved FAQ wording (spec §18)", () => {
  it("uses the EXACT approved answer, not the model's paraphrase (via customerQuestion)", async () => {
    const expected = matchFaq("Is this an IVA?")?.answer;
    expect(expected).toBeTruthy();
    mockAI.mockResolvedValue(
      aiJson({
        customerQuestion: "Is this an IVA?",
        reply: "Not at all — this chat is just to understand your situation.",
      })
    );
    const result = await processInboundMessage(makeLead({ preferredName: "Sam" }), [
      { role: "user", content: "Is this an IVA?" },
    ]);
    expect(result.reply).toBe(expected);
  });

  it("matches the FAQ from the raw message when the model doesn't extract it", async () => {
    const expected = matchFaq("do I need to give card details?")?.answer;
    expect(expected).toBeTruthy();
    mockAI.mockResolvedValue(
      aiJson({ customerQuestion: null, reply: "You won't need to share anything sensitive." })
    );
    const result = await processInboundMessage(makeLead({ preferredName: "Sam" }), [
      { role: "user", content: "do I need to give card details?" },
    ]);
    expect(result.reply).toBe(expected);
  });
});
