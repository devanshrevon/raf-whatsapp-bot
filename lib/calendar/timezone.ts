// Europe/London date/time handling (spec §14). All customer-facing times are
// London wall-clock; we convert to/from UTC instants using the Intl API so DST
// (BST/GMT) is handled correctly without any extra dependency.

export const APP_TIMEZONE = "Europe/London";

/**
 * Offset of Europe/London from UTC at a given instant, in milliseconds
 * (positive when London is ahead, i.e. +1h during BST).
 */
export function londonOffsetMs(instant: Date): number {
  const dtf = new Intl.DateTimeFormat("en-GB", {
    timeZone: APP_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  const parts = Object.fromEntries(
    dtf.formatToParts(instant).map((p) => [p.type, p.value])
  );
  const asUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second)
  );
  return asUtc - instant.getTime();
}

/** Convert a London wall-clock time to the matching UTC instant. */
export function londonWallTimeToUtc(
  year: number,
  month: number, // 1-12
  day: number,
  hour: number,
  minute: number
): Date {
  const guess = Date.UTC(year, month - 1, day, hour, minute);
  // Apply the offset at the guessed instant, then correct once more in case the
  // guess landed on the other side of a DST boundary.
  const offset1 = londonOffsetMs(new Date(guess));
  const candidate = new Date(guess - offset1);
  const offset2 = londonOffsetMs(candidate);
  return offset2 === offset1 ? candidate : new Date(guess - offset2);
}

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_RE = /^(\d{1,2}):(\d{2})$/;

/** Combine "YYYY-MM-DD" + "HH:MM" (London) into a UTC instant, or null. */
export function combineDateAndTime(
  dateStr: string,
  timeStr: string
): Date | null {
  const d = DATE_RE.exec(dateStr);
  const t = TIME_RE.exec(timeStr);
  if (!d || !t) return null;

  const [, y, mo, day] = d;
  const [, h, mi] = t;
  const hour = Number(h);
  const minute = Number(mi);
  if (hour > 23 || minute > 59) return null;

  return londonWallTimeToUtc(Number(y), Number(mo), Number(day), hour, minute);
}

/** London calendar parts for an instant. */
export function londonParts(instant: Date): {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  weekday: string;
  dateStr: string;
} {
  const dtf = new Intl.DateTimeFormat("en-GB", {
    timeZone: APP_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    weekday: "long",
    hourCycle: "h23",
  });
  const p = Object.fromEntries(
    dtf.formatToParts(instant).map((x) => [x.type, x.value])
  );
  return {
    year: Number(p.year),
    month: Number(p.month),
    day: Number(p.day),
    hour: Number(p.hour),
    minute: Number(p.minute),
    weekday: p.weekday,
    dateStr: `${p.year}-${p.month}-${p.day}`,
  };
}

/** e.g. "Tuesday 9 June". */
export function formatLondonDate(instant: Date): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: APP_TIMEZONE,
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(instant);
}

/** e.g. "5:00 pm". */
export function formatLondonTime(instant: Date): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: APP_TIMEZONE,
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  })
    .format(instant)
    .toLowerCase();
}

/** e.g. "Tuesday 9 June at 5:00 pm". */
export function formatLondonSlot(instant: Date): string {
  return `${formatLondonDate(instant)} at ${formatLondonTime(instant)}`;
}

/** True if the instant falls on a Saturday or Sunday in Europe/London. */
export function isLondonWeekend(instant: Date): boolean {
  const weekday = londonParts(instant).weekday;
  return weekday === "Saturday" || weekday === "Sunday";
}
