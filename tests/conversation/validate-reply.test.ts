import { describe, it, expect } from "vitest";
import { validateReply } from "@/lib/ai/validate-reply";
import { makeLead } from "../helpers/lead";

describe("validateReply", () => {
  it("accepts a short, single-question reply", () => {
    const r = validateReply(
      "Thanks. Roughly how many organisations are involved?",
      makeLead({ preferredName: "Sam" })
    );
    expect(r.ok).toBe(true);
  });

  it("rejects multiple questions", () => {
    const r = validateReply("How are you? What do you owe?", makeLead());
    expect(r.ok).toBe(false);
    expect(r.reasons).toContain("multiple_questions");
  });

  it("rejects prohibited claims", () => {
    const r = validateReply(
      "We can guarantee your debt will be written off.",
      makeLead()
    );
    expect(r.ok).toBe(false);
    expect(r.reasons.some((x) => x.startsWith("claim:"))).toBe(true);
  });

  it("rejects re-asking a known field", () => {
    const r = validateReply(
      "What name would you like me to use?",
      makeLead({ preferredName: "Louise" })
    );
    expect(r.ok).toBe(false);
    expect(r.reasons).toContain("reask:preferredName");
  });

  it("rejects an over-long reply", () => {
    const r = validateReply("word ".repeat(120), makeLead());
    expect(r.ok).toBe(false);
    expect(r.reasons).toContain("too_long");
  });
});
