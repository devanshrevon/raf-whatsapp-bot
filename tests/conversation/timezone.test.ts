import { describe, it, expect } from "vitest";
import {
  combineDateAndTime,
  formatLondonSlot,
  londonParts,
} from "@/lib/calendar/timezone";

describe("timezone (Europe/London)", () => {
  it("resolves a BST date to the correct UTC instant (summer, UTC+1)", () => {
    // 9 June 2026 16:30 London (BST) == 15:30 UTC
    const d = combineDateAndTime("2026-06-09", "16:30");
    expect(d?.getTime()).toBe(Date.UTC(2026, 5, 9, 15, 30));
  });

  it("resolves a GMT date to the correct UTC instant (winter, UTC+0)", () => {
    // 15 Jan 2026 10:00 London (GMT) == 10:00 UTC
    const d = combineDateAndTime("2026-01-15", "10:00");
    expect(d?.getTime()).toBe(Date.UTC(2026, 0, 15, 10, 0));
  });

  it("round-trips back to the same London wall-clock parts", () => {
    const d = combineDateAndTime("2026-06-09", "17:00")!;
    const p = londonParts(d);
    expect(p.hour).toBe(17);
    expect(p.minute).toBe(0);
    expect(p.dateStr).toBe("2026-06-09");
    expect(p.weekday).toBe("Tuesday");
  });

  it("rejects malformed input", () => {
    expect(combineDateAndTime("09-06-2026", "17:00")).toBeNull();
    expect(combineDateAndTime("2026-06-09", "25:00")).toBeNull();
  });

  it("formats a human slot label", () => {
    const d = combineDateAndTime("2026-06-09", "17:00")!;
    expect(formatLondonSlot(d)).toBe("Tuesday 9 June at 5:00 pm");
  });
});
