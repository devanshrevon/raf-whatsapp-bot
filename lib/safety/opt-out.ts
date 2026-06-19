// Opt-out phrase detection (spec §21). Runs before the AI conversation call
// on every inbound message — if the customer opts out, we process it
// immediately without calling OpenAI at all.

// Exact phrases and patterns that signal a customer wants no further contact.
// Keep this list in one place so Raf can review and extend it before launch.
const OPT_OUT_PATTERNS: RegExp[] = [
  /\bstop\b/i,
  /\bstop messaging me\b/i,
  /\bdo not contact me\b/i,
  /\bdo not message me\b/i,
  /\bremove me\b/i,
  /\bunsubscribe\b/i,
  /\bleave me alone\b/i,
  /\bno more messages\b/i,
  /\bstop texting\b/i,
  /\bstop contacting\b/i,
  /\bdont contact me\b/i,
  /\bdon't contact me\b/i,
  /\bnot interested\b/i,
  /\bopt out\b/i,
  /\bopt-out\b/i,
  // NB: bare "cancel" is intentionally NOT here — "cancel my appointment" is an
  // appointment cancellation, not an opt-out (see lib/conversation/cancel-intent.ts).
];

/**
 * Returns true if the message body contains a clear opt-out phrase.
 * Used by the inbound webhook BEFORE calling OpenAI (spec §21).
 */
export function isOptOut(body: string): boolean {
  const text = body.trim();
  return OPT_OUT_PATTERNS.some((pattern) => pattern.test(text));
}

/** The single approved confirmation message sent on opt-out (spec §21). */
export const OPT_OUT_CONFIRMATION =
  "Understood. We won't send you any more messages.";
