import { describe, it, expect } from "vitest";
import { deRepeatReply } from "@/lib/conversation/anti-repeat";
import { DATA_FIELDS } from "@/lib/conversation/fields";
import type { NextStep } from "@/lib/conversation/determine-next-action";

const housing = DATA_FIELDS.find((f) => f.key === "housingStatus")!;
const askHousing: NextStep = { stage: "COLLECTING_DETAILS", action: "ASK_FIELD", askField: housing };

describe("deRepeatReply", () => {
  it("passes the reply through when it differs from the last bot message", () => {
    const r = deRepeatReply("What's your housing situation?", "Thanks, what's your name?", askHousing, "Sam");
    expect(r).toBe("What's your housing situation?");
  });

  it("rephrases with an example when it would repeat the last message verbatim", () => {
    const reply = "What's your housing situation?";
    const r = deRepeatReply(reply, reply, askHousing, "Sam");
    expect(r).not.toBe(reply);
    expect(r.toLowerCase()).toContain("for example");
  });

  it("ignores case/whitespace when detecting a repeat", () => {
    const r = deRepeatReply("  what's your HOUSING situation?  ", "What's your housing situation?", askHousing, "Sam");
    expect(r.toLowerCase()).toContain("for example");
  });

  it("backs off to a pause message if even the example version repeats", () => {
    const withExample = `${housing.question} For example: ${housing.example}.`;
    const r = deRepeatReply(withExample, withExample, askHousing, "Sam");
    expect(r.toLowerCase()).toContain("whenever you're ready");
    expect(r).toContain("Sam");
  });

  it("uses a generic nudge for non-ASK steps", () => {
    const step: NextStep = { stage: "READY_FOR_CALLBACK", action: "PROPOSE_CALLBACK", askField: null };
    const reply = "Would you like me to arrange a callback?";
    const r = deRepeatReply(reply, reply, step, null);
    expect(r).not.toBe(reply);
    expect(r.toLowerCase()).toContain("whenever you're ready");
  });
});
