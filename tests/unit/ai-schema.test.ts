import { describe, it, expect } from "vitest";
import { parseAiResponse, factsSchema } from "@/lib/ai/schema";

describe("parseAiResponse", () => {
  it("parses a minimal valid response with defaults", () => {
    const r = parseAiResponse('{"reply":"Hi there"}');
    expect(r).not.toBeNull();
    expect(r?.reply).toBe("Hi there");
    expect(r?.riskLevel).toBe(0);
    expect(r?.facts.debtTypes).toEqual([]);
  });

  it("returns null on invalid JSON (spec §26)", () => {
    expect(parseAiResponse("not json at all")).toBeNull();
    expect(parseAiResponse("")).toBeNull();
  });

  it("normalises corrections from strings to objects", () => {
    const r = parseAiResponse('{"reply":"ok","corrections":["estimatedDebt"]}');
    expect(r?.corrections).toEqual([{ field: "estimatedDebt" }]);
  });

  it("clamps riskLevel into 0–3", () => {
    expect(parseAiResponse('{"reply":"x","riskLevel":5}')?.riskLevel).toBe(3);
    expect(parseAiResponse('{"reply":"x","riskLevel":-2}')?.riskLevel).toBe(0);
    expect(parseAiResponse('{"reply":"x","riskLevel":"2"}')?.riskLevel).toBe(2);
  });

  it("coerces messy money strings to numbers", () => {
    const facts = factsSchema.parse({ estimatedDebt: "£14,000" });
    expect(facts.estimatedDebt).toBe(14000);
  });
});
