import { describe, it, expect } from "vitest";
import {
  generateCandidateSlots,
  isSlotFree,
  isWithinBusinessHours,
} from "@/lib/calendar/slots";
import { combineDateAndTime, formatLondonTime } from "@/lib/calendar/timezone";

// A point well before the test date so "lead time" never filters slots out.
const NOW = new Date(Date.UTC(2026, 5, 1, 9, 0));

describe("generateCandidateSlots", () => {
  it("offers slots from the earliest preferred time", () => {
    const slots = generateCandidateSlots({
      dateStr: "2026-06-09",
      earliestTime: "16:30",
      now: NOW,
    });
    expect(slots.map(formatLondonTime)).toEqual(["4:30 pm", "5:00 pm", "5:30 pm"]);
  });

  it("skips slots that clash with busy intervals", () => {
    const busy = [
      {
        start: combineDateAndTime("2026-06-09", "17:00")!,
        end: combineDateAndTime("2026-06-09", "17:30")!,
      },
    ];
    const slots = generateCandidateSlots({
      dateStr: "2026-06-09",
      earliestTime: "16:30",
      busy,
      now: NOW,
    });
    // 17:00 clashes; 18:00 would end at 18:30 (past close), so only two remain.
    expect(slots.map(formatLondonTime)).toEqual(["4:30 pm", "5:30 pm"]);
  });

  it("never offers a slot ending after business close", () => {
    const slots = generateCandidateSlots({
      dateStr: "2026-06-09",
      earliestTime: "17:30",
      now: NOW,
      count: 10,
    });
    // 17:30 is the last valid start for a 30-min slot before 18:00 close.
    expect(slots.map(formatLondonTime)).toEqual(["5:30 pm"]);
  });

  it("excludes slots that don't meet the lead-time notice", () => {
    // now is 16:45 on the day itself; 60-min lead => first slot is 17:45 -> 18:00
    const sameDayNow = combineDateAndTime("2026-06-09", "16:45")!;
    const slots = generateCandidateSlots({
      dateStr: "2026-06-09",
      earliestTime: "16:30",
      now: sameDayNow,
    });
    expect(slots.every((s) => s.getTime() >= sameDayNow.getTime() + 60 * 60_000)).toBe(
      true
    );
  });
});

describe("isSlotFree / isWithinBusinessHours", () => {
  it("detects a clashing slot", () => {
    const start = combineDateAndTime("2026-06-09", "17:00")!;
    const busy = [
      {
        start: combineDateAndTime("2026-06-09", "17:15")!,
        end: combineDateAndTime("2026-06-09", "17:45")!,
      },
    ];
    expect(isSlotFree(start, busy)).toBe(false);
    expect(isSlotFree(start, [])).toBe(true);
  });

  it("rejects slots outside business hours", () => {
    expect(isWithinBusinessHours(combineDateAndTime("2026-06-09", "08:00")!)).toBe(
      false
    );
    expect(isWithinBusinessHours(combineDateAndTime("2026-06-09", "17:30")!)).toBe(
      true
    );
    expect(isWithinBusinessHours(combineDateAndTime("2026-06-09", "18:00")!)).toBe(
      false
    );
  });
});
