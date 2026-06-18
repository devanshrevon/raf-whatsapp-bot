import { z } from "zod";

// Structured shape we require from every ordinary OpenAI call (spec §11).
// The response is parsed and validated with this schema before we trust any of
// it — the AI never writes to the database directly (spec §5.3).

// A number that may arrive as a string ("£14,000", "14000") or null.
const looseNumber = z
  .union([z.number(), z.string(), z.null()])
  .transform((v) => {
    if (v === null || v === "") return null;
    if (typeof v === "number") return Number.isFinite(v) ? v : null;
    const digits = v.replace(/[^0-9.]/g, "");
    if (!digits) return null;
    const n = Number(digits);
    return Number.isFinite(n) ? n : null;
  })
  .pipe(z.number().nullable());

const nullableString = z
  .union([z.string(), z.null()])
  .transform((v) => (typeof v === "string" && v.trim() ? v.trim() : null));

const nullableBool = z.union([z.boolean(), z.null()]).catch(null);

export const factsSchema = z.object({
  preferredName: nullableString.default(null),
  debtTypes: z.array(z.string()).default([]),
  estimatedDebt: looseNumber.default(null),
  creditorCount: looseNumber.default(null),
  monthlyPayment: looseNumber.default(null),
  region: nullableString.default(null),
  housingStatus: nullableString.default(null),
  employmentStatus: nullableString.default(null),
  dependantSummary: nullableString.default(null),
  motivation: nullableString.default(null),
  callbackConsent: nullableBool.default(null),
  // Optional disclosures, stored only when volunteered (spec §7).
  paymentArrears: nullableBool.default(null),
  bailiffInvolvement: nullableBool.default(null),
  courtAction: nullableBool.default(null),
  carFinanceConcern: nullableBool.default(null),
  recentIncomeLoss: nullableBool.default(null),
  relationshipBreakdown: nullableBool.default(null),
  businessDebtConcern: nullableBool.default(null),
});

export type ExtractedFacts = z.infer<typeof factsSchema>;

export const aiResponseSchema = z.object({
  intent: z.string().default("OTHER"),
  facts: factsSchema.default({}),
  // Field keys (from facts) the customer has corrected, so we override stored
  // values even when already set (spec §13.3).
  corrections: z
    .array(
      z.union([
        z.string().transform((field) => ({ field })),
        z.object({ field: z.string() }).passthrough(),
      ])
    )
    .default([]),
  customerQuestion: nullableString.default(null),
  // Booking availability the customer expressed (spec §14). The app — not the
  // model — turns these into real slots and confirms anything.
  availability: z
    .object({
      date: nullableString.default(null), // YYYY-MM-DD (London)
      earliestTime: nullableString.default(null), // HH:MM (London)
    })
    .default({ date: null, earliestTime: null }),
  // When the customer picks a slot we offered, the ISO instant of that slot.
  selectedSlotStart: nullableString.default(null),
  // Clamp anything the model returns into the valid 0–3 band (never reset a
  // high risk to 0 by accident).
  riskLevel: z
    .preprocess((v) => {
      const n = typeof v === "number" ? v : Number(v);
      if (!Number.isFinite(n)) return 0;
      return Math.max(0, Math.min(3, Math.round(n)));
    }, z.number())
    .default(0),
  riskFlags: z.array(z.string()).default([]),
  suggestedNextAction: z.string().default(""),
  reply: z.string().default(""),
});

export type AiResponse = z.infer<typeof aiResponseSchema>;

/** Parse raw model output, returning null on any failure (spec §26: invalid JSON). */
export function parseAiResponse(raw: string): AiResponse | null {
  try {
    const json = JSON.parse(raw);
    const result = aiResponseSchema.safeParse(json);
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}
