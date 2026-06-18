import { describe, it, expect } from "vitest";
import { matchFaq } from "@/lib/conversation/faq";

describe("matchFaq", () => {
  it("matches the IVA question", () => {
    expect(matchFaq("Is this only about an IVA?")?.key).toBe("ivaOnly");
  });

  it("matches the card-details question", () => {
    expect(matchFaq("Do I need to give card details?")?.key).toBe("cardDetails");
  });

  it("returns null for an unrelated message", () => {
    expect(matchFaq("I owe about 20k")).toBeNull();
    expect(matchFaq(null)).toBeNull();
  });
});
