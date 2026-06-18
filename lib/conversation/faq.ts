// Approved FAQ answers (spec §18). Plain config — no FAQ-management UI.
// Wording follows the spec's guidance; final sign-off is Raf's before launch.
// The bot must NOT invent answers or go beyond these (spec §19).

export type FaqEntry = {
  key: string;
  /** Lowercase substrings that suggest the customer is asking this. */
  matchers: string[];
  answer: string;
};

export const APPROVED_FAQ: FaqEntry[] = [
  {
    key: "ivaOnly",
    matchers: ["only about an iva", "is this an iva", "just an iva", "only iva"],
    answer:
      "No. The call is to understand your situation and explain the options that may be available. You won't be asked to make any decisions during this chat.",
  },
  {
    key: "proofOfIncome",
    matchers: ["proof of income", "payslip", "bank statement", "evidence of income"],
    answer:
      "You don't need to upload any proof here. If anything's needed, the adviser can explain that during your call.",
  },
  {
    key: "cardDetails",
    matchers: ["card details", "card number", "payment details", "pay you", "cvv", "pin"],
    answer:
      "You'll never be asked for card numbers, PINs, passwords, or one-time codes here, and there's nothing to pay to have this chat.",
  },
  {
    key: "canICall",
    matchers: ["can i call", "phone you", "your number", "call you back", "ring you"],
    answer:
      "Raf's team will call you at a time we arrange together. I can book that callback for you now if you'd like.",
  },
  {
    key: "canYouDefinitelyHelp",
    matchers: ["definitely help", "can you help me", "will this work", "guarantee", "sort my debt"],
    answer:
      "The team can look at your situation and explain the options that may help. I can't promise a particular outcome, but the call is a good place to get clear answers.",
  },
];

/** Find an approved answer for a free-text question, or null if none matches. */
export function matchFaq(question: string | null | undefined): FaqEntry | null {
  if (!question) return null;
  const text = question.toLowerCase();
  return APPROVED_FAQ.find((e) => e.matchers.some((m) => text.includes(m))) ?? null;
}

/** Compact list for injecting the approved wording into the system prompt. */
export function faqForPrompt(): string {
  return APPROVED_FAQ.map((e) => `- (${e.key}) ${e.answer}`).join("\n");
}
