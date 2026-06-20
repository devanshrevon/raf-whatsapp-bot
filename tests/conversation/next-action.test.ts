import { describe, it, expect } from "vitest";
import { determineNextStep } from "@/lib/conversation/determine-next-action";
import { makeLead, makeCompleteLead } from "../helpers/lead";

describe("determineNextStep", () => {
  it("opens by asking for the name on first contact", () => {
    const step = determineNextStep(makeLead(), 0);
    expect(step.action).toBe("ASK_FIELD");
    expect(step.askField?.key).toBe("preferredName");
    expect(step.stage).toBe("DISCOVERING_SITUATION");
  });

  it("collects details once a name is known, in field order", () => {
    const step = determineNextStep(makeLead({ preferredName: "Sam" }), 0);
    expect(step.action).toBe("ASK_FIELD");
    expect(step.askField?.key).toBe("debtTypes");
    expect(step.stage).toBe("COLLECTING_DETAILS");
  });

  it("proposes a callback once all details are in but consent is missing", () => {
    const step = determineNextStep(makeCompleteLead(), 0);
    expect(step.action).toBe("PROPOSE_CALLBACK");
    expect(step.stage).toBe("READY_FOR_CALLBACK");
  });

  it("collects availability after consent", () => {
    const step = determineNextStep(
      makeCompleteLead({ callbackConsent: true }),
      0
    );
    expect(step.action).toBe("COLLECT_AVAILABILITY");
    expect(step.stage).toBe("COLLECTING_AVAILABILITY");
  });

  it("escalates and halts ordinary progression at riskLevel 2+", () => {
    const step = determineNextStep(makeCompleteLead({ callbackConsent: true }), 2);
    expect(step.action).toBe("ESCALATE_HUMAN");
    expect(step.stage).toBe("NEEDS_HUMAN_REVIEW");
  });

  it("escalates on a lead already flagged vulnerable, even when this message reads low-risk", () => {
    // Regression (spec §20): the keyword pre-scan flags vulnerabilityLevel 2,
    // but a later message may come through with riskLevel 0. The lead's stored
    // level must still stop ordinary questions.
    const flagged = makeLead({ preferredName: "Sam", vulnerabilityLevel: 2 });
    const step = determineNextStep(flagged, 0);
    expect(step.action).toBe("ESCALATE_HUMAN");
    expect(step.stage).toBe("NEEDS_HUMAN_REVIEW");
  });
});
