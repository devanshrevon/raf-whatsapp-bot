import type { NextStep } from "@/lib/conversation/determine-next-action";

// Stops the bot sending the exact same message twice in a row. If the customer
// gives a non-answer (or goes off-topic), the engine still wants the same field,
// and the model tends to produce the identical sentence — which feels broken.
// When the new reply would repeat the previous bot message, we escalate the
// wording: add an example, then offer to pause, so the conversation never loops
// on a verbatim line.

function same(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

export function deRepeatReply(
  reply: string,
  lastBotMessage: string,
  step: NextStep,
  name?: string | null
): string {
  if (!reply || !lastBotMessage || !same(reply, lastBotMessage)) {
    return reply;
  }

  const who = name ? `, ${name}` : "";

  if (step.action === "ASK_FIELD" && step.askField) {
    const withExample = step.askField.example
      ? `${step.askField.question} For example: ${step.askField.example}.`
      : step.askField.question;

    // If even the example version matches the last message, stop pushing.
    if (!same(withExample, lastBotMessage)) {
      return withExample;
    }
    return `No problem if now isn't a good time${who}. Whenever you're ready, just let me know your ${step.askField.label} and we'll carry on.`;
  }

  // Non-question steps: a gentle, non-repeating nudge.
  return `No problem${who} — whenever you're ready, just send me a message and we'll carry on.`;
}
