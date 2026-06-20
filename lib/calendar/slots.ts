import { combineDateAndTime, isLondonWeekend, londonParts } from "@/lib/calendar/timezone";

// Pure slot calculation (spec §14). Given a date, the customer's earliest
// preferred time, and the busy intervals from Google Calendar, produce a few
// real, bookable slots. No availability is ever invented — callers feed in real
// free/busy data.

export type Interval = { start: Date; end: Date };

export type SlotOptions = {
  dateStr: string; // YYYY-MM-DD (London)
  earliestTime?: string | null; // HH:MM (London)
  busy?: Interval[];
  now?: Date;
  durationMinutes?: number;
  stepMinutes?: number;
  count?: number;
  openHour?: number; // London business hours
  closeHour?: number;
  leadMinutes?: number; // minimum notice before a slot
};

const DEFAULTS = {
  durationMinutes: 30,
  stepMinutes: 30,
  count: 3,
  openHour: 9,
  closeHour: 18,
  leadMinutes: 60,
};

function overlaps(start: Date, end: Date, busy: Interval[]): boolean {
  return busy.some((b) => start < b.end && b.start < end);
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/** Generate up to `count` available slot start times for a London date. */
export function generateCandidateSlots(options: SlotOptions): Date[] {
  const o = { ...DEFAULTS, ...options };
  const busy = options.busy ?? [];
  const now = options.now ?? new Date();
  const earliestNotice = new Date(now.getTime() + o.leadMinutes * 60_000);

  // Callbacks are weekdays only — never offer Saturday/Sunday slots (spec §14).
  const dayStart = combineDateAndTime(o.dateStr, `${pad(o.openHour)}:00`);
  if (!dayStart || isLondonWeekend(dayStart)) return [];

  // Where to start within the day: the later of business open and the
  // customer's earliest preferred time (rounded onto the step grid).
  let startHour = o.openHour;
  let startMinute = 0;
  if (options.earliestTime) {
    const m = /^(\d{1,2}):(\d{2})$/.exec(options.earliestTime);
    if (m) {
      const h = Number(m[1]);
      const min = Number(m[2]);
      if (h > o.openHour || (h === o.openHour && min > 0)) {
        startHour = h;
        startMinute = Math.ceil(min / o.stepMinutes) * o.stepMinutes;
        if (startMinute >= 60) {
          startHour += 1;
          startMinute = 0;
        }
      }
    }
  }

  const slots: Date[] = [];
  for (
    let h = startHour, m = startMinute;
    h < o.closeHour || (h === o.closeHour && m === 0);
    m += o.stepMinutes
  ) {
    if (m >= 60) {
      h += Math.floor(m / 60);
      m = m % 60;
    }
    if (h > o.closeHour) break;

    const start = combineDateAndTime(o.dateStr, `${pad(h)}:${pad(m)}`);
    if (!start) break;
    const end = new Date(start.getTime() + o.durationMinutes * 60_000);

    // Slot must finish by close.
    const closeInstant = combineDateAndTime(o.dateStr, `${pad(o.closeHour)}:00`);
    if (closeInstant && end > closeInstant) break;

    if (start < earliestNotice) continue; // too soon / in the past
    if (overlaps(start, end, busy)) continue;

    slots.push(start);
    if (slots.length >= o.count) break;
  }

  return slots;
}

/** Re-check a specific slot is free (spec §14: check the slot again). */
export function isSlotFree(
  start: Date,
  busy: Interval[],
  durationMinutes = DEFAULTS.durationMinutes
): boolean {
  const end = new Date(start.getTime() + durationMinutes * 60_000);
  return !overlaps(start, end, busy);
}

/** Is the slot within configured business hours for its London day? */
export function isWithinBusinessHours(
  start: Date,
  durationMinutes = DEFAULTS.durationMinutes,
  openHour = DEFAULTS.openHour,
  closeHour = DEFAULTS.closeHour
): boolean {
  // Weekdays only — no Saturday/Sunday callbacks (spec §14).
  if (isLondonWeekend(start)) return false;

  const startParts = londonParts(start);
  const end = new Date(start.getTime() + durationMinutes * 60_000);
  const endParts = londonParts(end);
  const startMinutes = startParts.hour * 60 + startParts.minute;
  const endMinutes = endParts.hour * 60 + endParts.minute;
  // End on the same day (no midnight wrap) and inside hours.
  if (endParts.dateStr !== startParts.dateStr && endMinutes !== 0) return false;
  return startMinutes >= openHour * 60 && (endMinutes <= closeHour * 60 || endMinutes === 0);
}

export const SLOT_DEFAULTS = DEFAULTS;
