import { describe, it, expect } from "vitest";
import { computeLeadUpdates } from "@/lib/conversation/apply-facts";
import { factsSchema } from "@/lib/ai/schema";
import { makeLead } from "../helpers/lead";

const facts = (partial: Record<string, unknown>) => factsSchema.parse(partial);

describe("computeLeadUpdates", () => {
  it("fills an empty field", () => {
    const updates = computeLeadUpdates(makeLead(), facts({ estimatedDebt: 14000 }));
    expect(updates.estimatedDebt).toBe(14000);
  });

  it("does NOT overwrite an existing value without a correction", () => {
    const lead = makeLead({ estimatedDebt: 40000 });
    const updates = computeLeadUpdates(lead, facts({ estimatedDebt: 31000 }));
    expect(updates.estimatedDebt).toBeUndefined();
  });

  it("overwrites an existing value when the customer corrects it", () => {
    const lead = makeLead({ estimatedDebt: 40000 });
    const updates = computeLeadUpdates(
      lead,
      facts({ estimatedDebt: 31000 }),
      ["estimatedDebt"]
    );
    expect(updates.estimatedDebt).toBe(31000);
  });

  it("unions debt types into an existing list", () => {
    const lead = makeLead({ debtTypes: ["credit_cards"] });
    const updates = computeLeadUpdates(
      lead,
      facts({ debtTypes: ["personal_loan", "credit_cards"] })
    );
    expect(updates.debtTypes).toEqual(["credit_cards", "personal_loan"]);
  });

  it("replaces debt types when corrected", () => {
    const lead = makeLead({ debtTypes: ["credit_cards"] });
    const updates = computeLeadUpdates(
      lead,
      facts({ debtTypes: ["council_tax"] }),
      ["debtTypes"]
    );
    expect(updates.debtTypes).toEqual(["council_tax"]);
  });

  it("only moves consent from false to true", () => {
    const updates = computeLeadUpdates(makeLead(), facts({ callbackConsent: true }));
    expect(updates.callbackConsent).toBe(true);

    const noChange = computeLeadUpdates(
      makeLead({ callbackConsent: true }),
      facts({ callbackConsent: false })
    );
    expect(noChange.callbackConsent).toBeUndefined();
  });

  it("captures optional disclosures when volunteered", () => {
    const updates = computeLeadUpdates(makeLead(), facts({ bailiffInvolvement: true }));
    expect(updates.bailiffInvolvement).toBe(true);
  });
});
