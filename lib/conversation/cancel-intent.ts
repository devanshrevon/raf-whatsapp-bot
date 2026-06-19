// Detects a customer asking to cancel their booked callback (not an opt-out).
// Runs before the AI call, like opt-out, but only acts when the lead actually
// has a booked appointment. Cancelling a callback ≠ "stop messaging me".

const CANCEL_PATTERNS: RegExp[] = [
  /\bcancel\b.*\b(appointment|appt|callback|call back|call|booking|meeting|slot)\b/i,
  /\b(appointment|callback|call back|booking|meeting|slot)\b.*\bcancel\b/i,
  /\bdon'?t\b.*\b(call|callback|ring)\b.*\b(me|anymore|any more)\b/i,
  /\bcan('?t| ?not)\b.*\bmake\b.*\b(the |my )?(appointment|callback|call|booking)\b/i,
  /\b(cancel|drop|scrap)\b.*\bthe (call|callback|appointment|booking)\b/i,
];

/** True if the message reads as a request to cancel the booked callback. */
export function isCancelAppointmentRequest(body: string): boolean {
  const text = body.trim();
  return CANCEL_PATTERNS.some((pattern) => pattern.test(text));
}

/** Approved confirmation after a cancellation, gently offering to rebook. */
export const CANCEL_CONFIRMATION =
  "No problem — I've cancelled that callback. Would you like to arrange a new time, or is there anything else I can help with?";
