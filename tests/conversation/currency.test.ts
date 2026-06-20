import { describe, it, expect } from "vitest";
import { detectForeignCurrency } from "@/lib/conversation/currency";

describe("detectForeignCurrency", () => {
  it("detects a dollar amount", () => {
    expect(detectForeignCurrency("I owe around $15,000")).toBe("$");
    expect(detectForeignCurrency("about 2000 USD")).toBe("$");
  });

  it("detects euro and rupee amounts", () => {
    expect(detectForeignCurrency("€2,000 on a card")).toBe("€");
    expect(detectForeignCurrency("around ₹500000")).toBe("₹");
  });

  it("returns null for GBP or no currency", () => {
    expect(detectForeignCurrency("I owe £15,000")).toBeNull();
    expect(detectForeignCurrency("about 15000 in total")).toBeNull();
    expect(detectForeignCurrency("")).toBeNull();
  });
});
