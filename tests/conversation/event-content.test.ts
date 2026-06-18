import { describe, it, expect } from "vitest";
import {
  buildEventSummary,
  buildEventDescription,
} from "@/lib/calendar/event-content";
import { makeCompleteLead, makeLead } from "../helpers/lead";

describe("calendar event content (spec §15)", () => {
  it("titles the event with the customer's name", () => {
    expect(buildEventSummary(makeCompleteLead())).toBe(
      "Debt consultation callback — Louise"
    );
  });

  it("includes the key call-prep fields and a dashboard link", () => {
    const desc = buildEventDescription(makeCompleteLead());
    expect(desc).toContain("Phone: +447911123456");
    expect(desc).toContain("£14,000");
    expect(desc).toContain("Location: Wales");
    expect(desc).toContain("/leads/lead_test");
  });

  it("adds a review flag only for higher vulnerability", () => {
    expect(buildEventDescription(makeCompleteLead())).not.toContain("Flagged for review");
    const flagged = buildEventDescription(
      makeLead({ vulnerabilityLevel: 2, vulnerabilityFlags: ["distress"] })
    );
    expect(flagged).toContain("Flagged for review");
  });
});
