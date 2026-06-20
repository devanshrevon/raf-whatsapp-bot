// Detects when a customer states a money amount in a non-GBP currency.
// The app stores/extracts amounts as plain numbers and the dashboard formats
// them as GBP, so a "$15,000" would otherwise be shown silently as "£15,000".
// We flag it instead so the team can confirm/normalise the figure (spec area E).

const FOREIGN_CURRENCY_PATTERNS: { symbol: string; pattern: RegExp }[] = [
  { symbol: "$", pattern: /\$\s?\d|\b(usd|dollars?|aud|cad)\b/i },
  { symbol: "€", pattern: /€\s?\d|\b(eur|euros?)\b/i },
  { symbol: "¥", pattern: /¥\s?\d|\b(jpy|yen)\b/i },
  { symbol: "₹", pattern: /₹\s?\d|\b(inr|rupees?)\b/i },
];

/** Returns the foreign-currency symbol mentioned alongside a figure, or null. */
export function detectForeignCurrency(text: string): string | null {
  if (!text) return null;
  for (const { symbol, pattern } of FOREIGN_CURRENCY_PATTERNS) {
    if (pattern.test(text)) return symbol;
  }
  return null;
}
