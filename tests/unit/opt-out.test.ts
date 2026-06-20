import { describe, it, expect } from "vitest";
import { isOptOut, OPT_OUT_CONFIRMATION } from "@/lib/safety/opt-out";

describe("isOptOut", () => {
  it("detects plain 'stop'", () => {
    expect(isOptOut("stop")).toBe(true);
    expect(isOptOut("STOP")).toBe(true);
    expect(isOptOut("  Stop  ")).toBe(true);
  });

  it("detects common opt-out phrases", () => {
    expect(isOptOut("stop messaging me")).toBe(true);
    expect(isOptOut("do not contact me")).toBe(true);
    expect(isOptOut("leave me alone")).toBe(true);
    expect(isOptOut("unsubscribe")).toBe(true);
    expect(isOptOut("remove me")).toBe(true);
    expect(isOptOut("opt out")).toBe(true);
    expect(isOptOut("not interested")).toBe(true);
    expect(isOptOut("no more messages")).toBe(true);
  });

  it("does not false-positive on normal messages", () => {
    expect(isOptOut("I owe about £14,000 in credit card debt")).toBe(false);
    expect(isOptOut("My name is Sarah")).toBe(false);
    expect(isOptOut("I live in Wales")).toBe(false);
    expect(isOptOut("Can you help me with my debts?")).toBe(false);
    expect(isOptOut("I'd like a callback tomorrow")).toBe(false);
  });

  it("does not false-positive on conversational use of 'stop'", () => {
    expect(isOptOut("please don't stop helping me")).toBe(false);
    expect(isOptOut("I had to stop paying my debts")).toBe(false);
    expect(isOptOut("I can't stop the interest building up")).toBe(false);
  });

  it("still detects a 'stop' command at the start of the message", () => {
    expect(isOptOut("Stop please")).toBe(true);
    expect(isOptOut("stop messaging me")).toBe(true);
  });

  it("exports the approved opt-out confirmation message", () => {
    expect(OPT_OUT_CONFIRMATION).toContain("won't send you any more messages");
  });
});
