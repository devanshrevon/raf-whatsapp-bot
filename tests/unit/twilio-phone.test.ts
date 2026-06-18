import { describe, it, expect } from "vitest";
import {
  toE164,
  toWhatsAppAddress,
  isValidE164,
} from "@/lib/twilio/phone";

describe("phone helpers", () => {
  it("strips the whatsapp: prefix to E.164", () => {
    expect(toE164("whatsapp:+447911123456")).toBe("+447911123456");
    expect(toE164("+447911123456")).toBe("+447911123456");
    expect(toE164("  whatsapp:+447911123456  ")).toBe("+447911123456");
  });

  it("adds the whatsapp: prefix without doubling it", () => {
    expect(toWhatsAppAddress("+447911123456")).toBe("whatsapp:+447911123456");
    expect(toWhatsAppAddress("whatsapp:+447911123456")).toBe(
      "whatsapp:+447911123456"
    );
  });

  it("validates E.164, accepting an optional whatsapp: prefix", () => {
    expect(isValidE164("+447911123456")).toBe(true);
    expect(isValidE164("whatsapp:+14155238886")).toBe(true);
    expect(isValidE164("07911123456")).toBe(false); // no +
    expect(isValidE164("+0123")).toBe(false); // leading zero
    expect(isValidE164("not-a-number")).toBe(false);
  });
});
