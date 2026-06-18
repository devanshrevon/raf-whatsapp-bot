import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  buildWebhookUrl,
  verifyTwilioSignature,
} from "@/lib/twilio/verify-signature";

export const dynamic = "force-dynamic";

/**
 * Twilio delivery-status callback (spec §5.1). Verifies the signature and
 * updates Message.deliveryStatus for the matching twilioMessageSid.
 */
export async function POST(request: NextRequest) {
  const signature = request.headers.get("x-twilio-signature") ?? "";
  const form = await request.formData();
  const params: Record<string, string> = {};
  for (const [key, value] of form.entries()) {
    params[key] = typeof value === "string" ? value : "";
  }

  const url = buildWebhookUrl({
    baseOverride: process.env.TWILIO_WEBHOOK_BASE_URL,
    proto: request.headers.get("x-forwarded-proto") ?? "https",
    host: request.headers.get("host") ?? request.nextUrl.host,
    pathname: request.nextUrl.pathname,
  });

  if (!verifyTwilioSignature({ signature, url, params })) {
    return new NextResponse("Invalid Twilio signature", { status: 403 });
  }

  const messageSid = params.MessageSid || params.SmsSid;
  const status = params.MessageStatus || params.SmsStatus;

  if (!messageSid || !status) {
    return new NextResponse("Missing MessageSid or MessageStatus", {
      status: 400,
    });
  }

  // updateMany so an unknown SID (e.g. a message we didn't store) is a no-op
  // rather than an error.
  await db.message.updateMany({
    where: { twilioMessageSid: messageSid },
    data: { deliveryStatus: status },
  });

  return new NextResponse(null, { status: 204 });
}
