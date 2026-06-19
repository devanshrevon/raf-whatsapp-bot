import { describe, it, expect } from "vitest";
import { isCancelAppointmentRequest } from "@/lib/conversation/cancel-intent";
import { isOptOut } from "@/lib/safety/opt-out";

describe("isCancelAppointmentRequest", () => {
  it("detects appointment-cancel phrases", () => {
    expect(isCancelAppointmentRequest("I want to cancel my appointment")).toBe(true);
    expect(isCancelAppointmentRequest("cancel the callback please")).toBe(true);
    expect(isCancelAppointmentRequest("please cancel my booking")).toBe(true);
    expect(isCancelAppointmentRequest("can you cancel my call")).toBe(true);
    expect(isCancelAppointmentRequest("I can't make the appointment")).toBe(true);
  });

  it("does not fire on unrelated messages", () => {
    expect(isCancelAppointmentRequest("I owe £14,000")).toBe(false);
    expect(isCancelAppointmentRequest("yes please book me in")).toBe(false);
    expect(isCancelAppointmentRequest("cancel culture is everywhere")).toBe(false);
  });

  it("a cancel-appointment request is NOT treated as an opt-out", () => {
    // Regression: bare 'cancel' used to opt the customer out entirely.
    expect(isOptOut("I want to cancel my appointment")).toBe(false);
    expect(isOptOut("cancel my callback")).toBe(false);
  });
});
