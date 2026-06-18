import { getBusyIntervals } from "@/lib/calendar/google";
import { generateCandidateSlots, SLOT_DEFAULTS } from "@/lib/calendar/slots";
import { combineDateAndTime } from "@/lib/calendar/timezone";

// Combine real Google Calendar free/busy with our slot rules (spec §14). The
// AI never invents availability — every offered slot comes from here.

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/** Real, bookable slots for a London date, honouring an earliest preferred time. */
export async function getAvailableSlots(input: {
  dateStr: string;
  earliestTime?: string | null;
  now?: Date;
  count?: number;
}): Promise<Date[]> {
  // Query free/busy across the whole London business day.
  const dayStart = combineDateAndTime(input.dateStr, `${pad(SLOT_DEFAULTS.openHour)}:00`);
  const dayEnd = combineDateAndTime(input.dateStr, `${pad(SLOT_DEFAULTS.closeHour)}:00`);
  if (!dayStart || !dayEnd) return [];

  const busy = await getBusyIntervals(dayStart, dayEnd);

  return generateCandidateSlots({
    dateStr: input.dateStr,
    earliestTime: input.earliestTime,
    busy,
    now: input.now,
    count: input.count ?? SLOT_DEFAULTS.count,
  });
}
