import { describe, it, expect } from "vitest";
import { checkProhibitedClaims } from "@/lib/safety/guardrails";

describe("checkProhibitedClaims — each prohibited pattern individually", () => {
  // debt_write_off
  it("flags 'write off' phrasing", () => {
    expect(checkProhibitedClaims("We can write off your debt").ok).toBe(false);
    expect(checkProhibitedClaims("Your debt will be written off").ok).toBe(false);
    expect(checkProhibitedClaims("This helps with debt write-off").ok).toBe(false);
  });

  // guaranteed_outcome
  it("flags 'guarantee' phrasing", () => {
    expect(checkProhibitedClaims("We guarantee you'll be helped").ok).toBe(false);
    expect(checkProhibitedClaims("Guaranteed results for everyone").ok).toBe(false);
    expect(checkProhibitedClaims("Our process guarantees success").ok).toBe(false);
  });

  // definite_qualification
  it("flags 'you will qualify' phrasing", () => {
    expect(checkProhibitedClaims("You will qualify for debt relief").ok).toBe(false);
    expect(checkProhibitedClaims("You'll definitely qualify based on that").ok).toBe(false);
  });

  // promised_results
  it("flags '100% clear/wipe/cancel/remove' phrasing", () => {
    expect(checkProhibitedClaims("We 100% clear all your debts").ok).toBe(false);
    expect(checkProhibitedClaims("Definitely wipe your credit card debt").ok).toBe(false);
  });

  // product_recommendation
  it("flags recommending a specific product", () => {
    expect(checkProhibitedClaims("You should get an IVA").ok).toBe(false);
    expect(checkProhibitedClaims("You should go for bankruptcy").ok).toBe(false);
    expect(checkProhibitedClaims("You should take out a DRO").ok).toBe(false);
    expect(checkProhibitedClaims("You should do an IVA").ok).toBe(false);
  });

  // claims_human
  it("flags claiming to be human or a debt adviser", () => {
    expect(checkProhibitedClaims("I am a human and I can help").ok).toBe(false);
    expect(checkProhibitedClaims("I am a real debt adviser").ok).toBe(false);
    expect(checkProhibitedClaims("I am a person at Raf's team").ok).toBe(false);
  });

  // requests_card_secret
  it("flags requesting card numbers or secure codes", () => {
    expect(checkProhibitedClaims("Please share your card number").ok).toBe(false);
    expect(checkProhibitedClaims("What is the CVV on your card?").ok).toBe(false);
    expect(checkProhibitedClaims("Please enter your PIN").ok).toBe(false);
    expect(checkProhibitedClaims("Enter the one-time code").ok).toBe(false);
    expect(checkProhibitedClaims("Enter the one-time password").ok).toBe(false);
    expect(checkProhibitedClaims("Share your password").ok).toBe(false);
  });
});

describe("checkProhibitedClaims — flags property", () => {
  it("returns the matching flag name(s)", () => {
    const result = checkProhibitedClaims("We guarantee debt write-off");
    expect(result.ok).toBe(false);
    expect(result.flags).toContain("guaranteed_outcome");
    expect(result.flags).toContain("debt_write_off");
  });

  it("returns empty flags on a clean reply", () => {
    const result = checkProhibitedClaims("Our team can explore your options with you.");
    expect(result.ok).toBe(true);
    expect(result.flags).toHaveLength(0);
  });
});

describe("checkProhibitedClaims — false positives (should NOT trigger)", () => {
  it("allows natural language about writing without flagging debt write-off", () => {
    // "write" on its own is fine; pattern requires "write off"
    expect(checkProhibitedClaims("I'll write down your details").ok).toBe(true);
  });

  it("allows discussing IVAs informatively without recommending them", () => {
    // The pattern is "you should get/take out/go for/do an IVA"
    expect(checkProhibitedClaims("An IVA is one option the adviser can explain").ok).toBe(true);
    expect(checkProhibitedClaims("The team can explain IVA, DRO, and other options").ok).toBe(true);
  });

  it("allows mentions of certainty that don't match the pattern", () => {
    expect(checkProhibitedClaims("Certainly, I can help you with that").ok).toBe(true);
  });

  it("allows a normal greeting that mentions a person's name", () => {
    expect(checkProhibitedClaims("Hi Louise, thanks for sharing that with me.").ok).toBe(true);
  });

  it("allows explaining what the consultation covers", () => {
    const reply =
      "The consultation is free and confidential. The adviser will look at your situation and explain your options.";
    expect(checkProhibitedClaims(reply).ok).toBe(true);
  });
});
