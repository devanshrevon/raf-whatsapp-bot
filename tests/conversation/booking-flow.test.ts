import { describe, it, expect, vi, beforeEach } from "vitest";
import { handleBookingTurn } from "@/lib/calendar/conversation-booking";
import { makeLead } from "../helpers/lead";
import { SlotUnavailableError } from "@/lib/calendar/booking";

// ── mocks ────────────────────────────────────────────────────────────────────

vi.mock("@/lib/calendar/availability", () => ({
  getAvailableSlots: vi.fn(),
}));

vi.mock("@/lib/calendar/booking", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/calendar/booking")>();
  return {
    ...actual,
    bookCallback: vi.fn(),
  };
});

import { getAvailableSlots } from "@/lib/calendar/availability";
import { bookCallback } from "@/lib/calendar/booking";

const mockSlots = getAvailableSlots as ReturnType<typeof vi.fn>;
const mockBook = bookCallback as ReturnType<typeof vi.fn>;

// Fixed test instants (BST — UTC+1)
const SLOT_1 = new Date("2026-06-20T09:00:00.000Z"); // 10:00 BST
const SLOT_2 = new Date("2026-06-20T10:00:00.000Z"); // 11:00 BST
const SLOT_3 = new Date("2026-06-20T11:00:00.000Z"); // 12:00 BST

beforeEach(() => {
  vi.clearAllMocks();
});

// ── test suite ────────────────────────────────────────────────────────────────

describe("handleBookingTurn — no actionable input", () => {
  it("returns reply=null when neither date nor selectedSlotStart is provided", async () => {
    const result = await handleBookingTurn({
      lead: makeLead(),
      availability: { date: null, earliestTime: null },
      selectedSlotStart: null,
    });
    expect(result.reply).toBeNull();
    expect(result.booked).toBe(false);
    expect(result.error).toBe(false);
  });
});

describe("handleBookingTurn — offering slots", () => {
  it("offers available slots when a date preference is given", async () => {
    mockSlots.mockResolvedValue([SLOT_1, SLOT_2, SLOT_3]);
    const result = await handleBookingTurn({
      lead: makeLead(),
      availability: { date: "2026-06-20", earliestTime: null },
      selectedSlotStart: null,
    });
    expect(result.booked).toBe(false);
    expect(result.error).toBe(false);
    expect(result.reply).toBeTruthy();
    expect(result.reply).toContain("Which works best?");
  });

  it("returns 'no free times' reply when calendar has no slots", async () => {
    mockSlots.mockResolvedValue([]);
    const result = await handleBookingTurn({
      lead: makeLead(),
      availability: { date: "2026-06-20", earliestTime: null },
      selectedSlotStart: null,
    });
    expect(result.booked).toBe(false);
    expect(result.error).toBe(false);
    expect(result.reply).toContain("don't have any free times");
  });

  it("respects the earliestTime preference when getting slots", async () => {
    mockSlots.mockResolvedValue([SLOT_2]);
    await handleBookingTurn({
      lead: makeLead(),
      availability: { date: "2026-06-20", earliestTime: "10:00" },
      selectedSlotStart: null,
    });
    expect(mockSlots).toHaveBeenCalledWith(
      expect.objectContaining({ dateStr: "2026-06-20", earliestTime: "10:00" })
    );
  });

  it("handles calendar API failure gracefully with error reply", async () => {
    mockSlots.mockRejectedValue(new Error("Google API down"));
    const result = await handleBookingTurn({
      lead: makeLead(),
      availability: { date: "2026-06-20", earliestTime: null },
      selectedSlotStart: null,
    });
    expect(result.booked).toBe(false);
    expect(result.error).toBe(true);
    expect(result.reply).toContain("trouble checking the calendar");
  });
});

describe("handleBookingTurn — booking a selected slot", () => {
  it("books successfully when customer picks a slot", async () => {
    mockBook.mockResolvedValue({ id: "appt_1", startAt: SLOT_1 });
    const result = await handleBookingTurn({
      lead: makeLead(),
      availability: { date: null, earliestTime: null },
      selectedSlotStart: SLOT_1.toISOString(),
    });
    expect(result.booked).toBe(true);
    expect(result.error).toBe(false);
    expect(result.reply).toContain("You're booked for");
    expect(result.reply).toContain("Raf's team will call you");
    expect(mockBook).toHaveBeenCalledOnce();
  });

  it("calls bookCallback with the correct lead and Date object", async () => {
    mockBook.mockResolvedValue({ id: "appt_2", startAt: SLOT_2 });
    const lead = makeLead({ id: "lead_abc" });
    await handleBookingTurn({
      lead,
      availability: { date: null, earliestTime: null },
      selectedSlotStart: SLOT_2.toISOString(),
    });
    const [calledLead, calledDate] = mockBook.mock.calls[0];
    expect(calledLead.id).toBe("lead_abc");
    expect(calledDate instanceof Date).toBe(true);
    expect(calledDate.getTime()).toBe(SLOT_2.getTime());
  });

  it("re-offers slots when the selected slot is taken (SlotUnavailableError)", async () => {
    mockBook.mockRejectedValue(new SlotUnavailableError());
    mockSlots.mockResolvedValue([SLOT_2, SLOT_3]);

    const result = await handleBookingTurn({
      lead: makeLead(),
      availability: { date: null, earliestTime: null },
      selectedSlotStart: SLOT_1.toISOString(),
    });

    expect(result.booked).toBe(false);
    expect(result.error).toBe(false);
    expect(result.reply).toContain("Sorry, that time has just been taken");
    expect(result.reply).toContain("Which works best?");
    // getAvailableSlots must be called for the fallback
    expect(mockSlots).toHaveBeenCalledOnce();
  });

  it("propagates non-SlotUnavailableError as a calendar error", async () => {
    mockBook.mockRejectedValue(new Error("Google Calendar 500"));
    const result = await handleBookingTurn({
      lead: makeLead(),
      availability: { date: null, earliestTime: null },
      selectedSlotStart: SLOT_1.toISOString(),
    });
    expect(result.booked).toBe(false);
    expect(result.error).toBe(true);
    expect(result.reply).toContain("trouble checking the calendar");
  });

  it("does NOT call bookCallback for an invalid ISO date string", async () => {
    const result = await handleBookingTurn({
      lead: makeLead(),
      availability: { date: null, earliestTime: null },
      selectedSlotStart: "not-a-date",
    });
    expect(mockBook).not.toHaveBeenCalled();
    // Falls through to 'nothing actionable' → null reply
    expect(result.reply).toBeNull();
    expect(result.booked).toBe(false);
  });
});

describe("handleBookingTurn — slot offer message format", () => {
  it("formats a single slot offer correctly", async () => {
    mockSlots.mockResolvedValue([SLOT_1]);
    const result = await handleBookingTurn({
      lead: makeLead(),
      availability: { date: "2026-06-20", earliestTime: null },
      selectedSlotStart: null,
    });
    // Single time — no "or" needed in the joinTimes output
    expect(result.reply).not.toContain(" or ");
    expect(result.reply).toContain("I can offer");
  });

  it("formats multiple slot offer with 'or' connector", async () => {
    mockSlots.mockResolvedValue([SLOT_1, SLOT_2, SLOT_3]);
    const result = await handleBookingTurn({
      lead: makeLead(),
      availability: { date: "2026-06-20", earliestTime: null },
      selectedSlotStart: null,
    });
    expect(result.reply).toContain(" or ");
  });
});
