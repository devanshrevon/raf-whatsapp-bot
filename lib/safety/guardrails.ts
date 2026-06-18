// Prohibited-claim detection (spec §19.1). A first, conservative pass used by
// lib/ai/validate-reply.ts. Phase 6 hardens this (vulnerability wording,
// safeguarding, fuller phrase coverage); the patterns here block the most
// damaging claims now so Phase 3 replies can't promise outcomes.

const PROHIBITED_PATTERNS: { flag: string; pattern: RegExp }[] = [
  { flag: "debt_write_off", pattern: /\bwrit(e|ten|ing)[\s-]*off\b/i },
  { flag: "guaranteed_outcome", pattern: /\b(guarantee|guaranteed|guarantees)\b/i },
  { flag: "definite_qualification", pattern: /\b(you'?ll definitely|you will|you definitely|certainly) qualif/i },
  { flag: "promised_results", pattern: /\b(100%|definitely|certainly) (clear|wipe|cancel|remove)/i },
  { flag: "product_recommendation", pattern: /\byou should (get|take out|go for|do) (an? )?(iva|dro|bankruptcy|debt relief order)\b/i },
  { flag: "claims_human", pattern: /\bi am a (real )?(human|person|debt adviser|advisor)\b/i },
  { flag: "requests_card_secret", pattern: /\b(card number|cvv|pin|password|one[\s-]*time (code|password)|otp)\b/i },
];

export type GuardrailResult = { ok: boolean; flags: string[] };

/** Returns ok:false with the matched flags if the text makes a prohibited claim. */
export function checkProhibitedClaims(text: string): GuardrailResult {
  const flags = PROHIBITED_PATTERNS.filter((p) => p.pattern.test(text)).map(
    (p) => p.flag
  );
  return { ok: flags.length === 0, flags };
}
