import type { Lead } from "@prisma/client";
import { getAvailableSlots } from "@/lib/calendar/availability";
import { bookCallback, SlotUnavailableError } from "@/lib/calendar/booking";
import {
  formatLondonDate,
  formatLondonSlot,
  formatLondonTime,
  londonParts,
} from "@/lib/calendar/timezone";

// Drives the WhatsApp booking turn (spec §14). All slot offers and the booking
// confirmation are generated HERE from real calendar data — the AI never
// invents times or confirms a booking. The route calls this when the lead has
// reached the availability step and has no active appointment.

export type BookingTurnResult = {
  /** App-generated reply that overrides the AI's, or null to keep the AI reply. */
  reply: string | null;
  booked: boolean;
  error: boolean;
};

function joinTimes(times: string[]): string {
  if (times.length === 1) return times[0];
  return `${times.slice(0, -1).join(", ")} or ${times[times.length - 1]}`;
}

async function offerSlots(
  lead: Lead,
  dateStr: string,
  earliestTime: string | null,
  prefix: string
): Promise<BookingTurnResult> {
  const slots = await getAvailableSlots({ dateStr, earliestTime });
  if (slots.length === 0) {
    return {
      reply: `${prefix}I'm afraid I don't have any free times that day. Is there another day that might suit you?`,
      booked: false,
      error: false,
    };
  }
  const dateLabel = formatLondonDate(slots[0]);
  const offer = joinTimes(slots.map(formatLondonTime));
  return {
    reply: `${prefix}I can offer ${offer} on ${dateLabel}. Which works best?`,
    booked: false,
    error: false,
  };
}

export async function handleBookingTurn(input: {
  lead: Lead;
  availability: { date: string | null; earliestTime: string | null };
  selectedSlotStart: string | null;
}): Promise<BookingTurnResult> {
  const { lead, availability, selectedSlotStart } = input;

  try {
    // 1. Customer picked a slot → re-check and book (spec §14).
    if (selectedSlotStart) {
      const start = new Date(selectedSlotStart);
      if (!Number.isNaN(start.getTime())) {
        try {
          await bookCallback(lead, start);
          return {
            reply: `You're booked for ${formatLondonSlot(start)}. A member of Raf's team will call you on this number.`,
            booked: true,
            error: false,
          };
        } catch (error) {
          if (error instanceof SlotUnavailableError) {
            // Slot taken since we offered it — re-offer for that day.
            return await offerSlots(
              lead,
              londonParts(start).dateStr,
              null,
              "Sorry, that time has just been taken. "
            );
          }
          throw error;
        }
      }
    }

    // 2. Customer gave a day/time preference → offer real slots.
    if (availability.date) {
      return await offerSlots(lead, availability.date, availability.earliestTime, "");
    }

    // 3. Nothing actionable this turn — keep the AI's reply (which asks for a time).
    return { reply: null, booked: false, error: false };
  } catch {
    return {
      reply:
        "I'm having a little trouble checking the calendar just now. I'll make sure someone from Raf's team arranges your callback.",
      booked: false,
      error: true,
    };
  }
}
