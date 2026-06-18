import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  buildWebhookUrl,
  verifyTwilioSignature,
} from "@/lib/twilio/verify-signature";
import { sendWhatsAppMessage } from "@/lib/twilio/send-message";
import { toE164 } from "@/lib/twilio/phone";

export const dynamic = "force-dynamic";

// Empty TwiML — we reply via the REST API (lib/twilio/send-message), so the
// webhook response itself carries no message.
const EMPTY_TWIML =
  '<?xml version="1.0" encoding="UTF-8"?><Response></Response>';

function twiml(status = 200): NextResponse {
  return new NextResponse(EMPTY_TWIML, {
    status,
    headers: { "Content-Type": "text/xml" },
  });
}

// Phase 2 placeholder replies. Phase 3 replaces this with the OpenAI
// conversation engine (lib/ai/process-message.ts). The first line is the
// approved intro from spec §13.1; later turns get a neutral holding line until
// the engine is wired up.
const INTRO_REPLY =
  "Hi, I'm the virtual assistant supporting Raf's team. What name would you like me to use?";
const HOLDING_REPLY =
  "Thanks, I've got your message. Someone from Raf's team will be in touch shortly.";

/**
 * Inbound WhatsApp webhook (spec §10). Phase 2 wires the pipeline up to
 * storing the message and sending a reply; the OpenAI fact-extraction and
 * next-action logic arrive in Phase 3.
 */
export async function POST(request: NextRequest) {
  // 1. Verify the Twilio signature.
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
  const from = params.From;
  const body = params.Body ?? "";

  if (!messageSid || !from) {
    return new NextResponse("Missing MessageSid or From", { status: 400 });
  }

  // 2. Deduplicate on the Twilio MessageSid (Twilio retries webhooks).
  const duplicate = await db.message.findUnique({
    where: { twilioMessageSid: messageSid },
  });
  if (duplicate) {
    return twiml();
  }

  // 3. Load or create the lead by phone number.
  const phone = toE164(from);
  const lead = await db.lead.upsert({
    where: { phoneNumber: phone },
    update: { lastCustomerMessageAt: new Date() },
    create: { phoneNumber: phone, lastCustomerMessageAt: new Date() },
  });

  // 4. Store the inbound message.
  await db.message.create({
    data: {
      leadId: lead.id,
      twilioMessageSid: messageSid,
      direction: "INBOUND",
      senderType: "CUSTOMER",
      body,
    },
  });

  // 5. Do not auto-reply if the customer opted out or the bot is paused
  //    (full opt-out detection of free-text "stop" arrives in Phase 6).
  if (lead.optedOut || lead.botPaused) {
    return twiml();
  }

  // 6. Send the Phase 2 placeholder reply.
  const outboundCount = await db.message.count({
    where: { leadId: lead.id, direction: "OUTBOUND" },
  });
  const reply = outboundCount === 0 ? INTRO_REPLY : HOLDING_REPLY;

  try {
    await sendWhatsAppMessage({
      leadId: lead.id,
      to: phone,
      body: reply,
      senderType: "BOT",
      promptVersion: "phase2-placeholder",
    });
  } catch (error) {
    // Log the failure but still 200 so Twilio doesn't hammer retries; the
    // inbound message is already stored for the team to see.
    await db.systemEvent.create({
      data: {
        leadId: lead.id,
        eventType: "external_api_failure",
        detail: {
          where: "twilio_send",
          message: error instanceof Error ? error.message : String(error),
        },
      },
    });
  }

  return twiml();
}
