import { NextRequest, NextResponse } from "next/server";

/**
 * Inbound WhatsApp message webhook (spec section 10).
 *
 * Phase 2 will implement, in this order:
 *   1. Verify the Twilio webhook signature (lib/twilio/verify-signature.ts)
 *   2. Check the Twilio MessageSid against `Message.twilioMessageSid` for duplicates
 *   3. Load or create the Lead by phone number
 *   4. Check optedOut / botPaused — stop here if either is true
 *   5. Call OpenAI with the message + known lead state (lib/ai/process-message.ts)
 *   6. Validate the structured response with Zod (lib/ai/schema.ts)
 *   7. Update the Lead record with extracted facts
 *   8. Determine the next allowed action (lib/conversation/determine-next-action.ts)
 *   9. Validate the proposed reply (lib/ai/validate-reply.ts)
 *   10. Send the reply through Twilio and store the outbound Message
 *   11. Schedule or cancel follow-up ScheduledActions as needed
 *
 * Until that's built, this returns 501 so Twilio's retry behaviour doesn't
 * mask the fact that nothing is wired up yet.
 */
export async function POST(_request: NextRequest) {
  return NextResponse.json(
    { error: "Not implemented yet — Phase 2 (Twilio + conversation engine)." },
    { status: 501 }
  );
}
