import type { Lead } from "@prisma/client";

// Build a full Lead with sensible empty defaults for tests; override as needed.
export function makeLead(overrides: Partial<Lead> = {}): Lead {
  const now = new Date("2026-06-18T12:00:00Z");
  return {
    id: "lead_test",
    phoneNumber: "+447911123456",
    preferredName: null,
    status: "ACTIVE",
    conversationStage: "NEW",
    debtTypes: [],
    estimatedDebt: null,
    creditorCount: null,
    monthlyPayment: null,
    region: null,
    housingStatus: null,
    employmentStatus: null,
    dependantSummary: null,
    motivation: null,
    paymentArrears: null,
    bailiffInvolvement: null,
    courtAction: null,
    carFinanceConcern: null,
    recentIncomeLoss: null,
    relationshipBreakdown: null,
    businessDebtConcern: null,
    callbackConsent: false,
    optedOut: false,
    botPaused: false,
    vulnerabilityLevel: 0,
    vulnerabilityFlags: [],
    followUpCount: 0,
    lastCustomerMessageAt: null,
    lastBotMessageAt: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

// A lead with every required data field filled (but no consent yet).
export function makeCompleteLead(overrides: Partial<Lead> = {}): Lead {
  return makeLead({
    preferredName: "Louise",
    debtTypes: ["credit_cards"],
    estimatedDebt: 14000,
    creditorCount: 3,
    monthlyPayment: 200,
    region: "Wales",
    housingStatus: "renting",
    employmentStatus: "benefits",
    dependantSummary: "two children",
    motivation: "struggling with payments",
    ...overrides,
  });
}
