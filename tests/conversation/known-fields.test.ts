import { describe, it, expect } from "vitest";
import {
  missingDataFields,
  hasAllDetails,
  isReadyForCallback,
} from "@/lib/conversation/known-fields";
import { makeLead, makeCompleteLead } from "../helpers/lead";

describe("known-fields", () => {
  it("reports all 10 data fields missing on a fresh lead", () => {
    expect(missingDataFields(makeLead()).length).toBe(10);
    expect(hasAllDetails(makeLead())).toBe(false);
  });

  it("treats an empty debtTypes array as missing", () => {
    const lead = makeLead({ preferredName: "Sam", debtTypes: [] });
    expect(missingDataFields(lead).some((f) => f.key === "debtTypes")).toBe(true);
    expect(missingDataFields(lead).some((f) => f.key === "preferredName")).toBe(
      false
    );
  });

  it("treats monthlyPayment of 0 as known (a valid answer)", () => {
    const lead = makeLead({ monthlyPayment: 0 });
    expect(missingDataFields(lead).some((f) => f.key === "monthlyPayment")).toBe(
      false
    );
  });

  it("is ready for callback only with all details AND consent", () => {
    expect(hasAllDetails(makeCompleteLead())).toBe(true);
    expect(isReadyForCallback(makeCompleteLead())).toBe(false);
    expect(isReadyForCallback(makeCompleteLead({ callbackConsent: true }))).toBe(
      true
    );
  });
});
