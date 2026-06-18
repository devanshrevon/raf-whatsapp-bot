import { NextRequest, NextResponse } from "next/server";

/**
 * Twilio delivery-status callback. Phase 2 will verify the signature and
 * update Message.deliveryStatus by twilioMessageSid.
 */
export async function POST(_request: NextRequest) {
  return NextResponse.json(
    { error: "Not implemented yet — Phase 2 (Twilio integration)." },
    { status: 501 }
  );
}
