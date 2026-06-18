import { NextRequest, NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import {
  buildWebhookUrl,
  verifyTwilioSignature,
} from "@/lib/twilio/verify-signature";
import { sendWhatsAppMessage } from "@/lib/twilio/send-message";
import { toE164 } from "@/lib/twilio/phone";
import { processInboundMessage } from "@/lib/ai/process-message";
import type { ChatMessage } from "@/lib/ai/client";
import { handleBookingTurn } from "@/lib/calendar/conversation-booking";

export const dynamic = "force-dynamic";

// How many past turns to give the model for context.
const HISTORY_LIMIT = 20;

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

async function logEvent(
  leadId: string,
  eventType: string,
  detail: Prisma.InputJsonValue
) {
  await db.systemEvent.create({ data: { leadId, eventType, detail } });
}

/**
 * Inbound WhatsApp webhook (spec §10):
 * verify → dedup → load/create lead → store inbound → opt-out/pause gate →
 * OpenAI conversation engine → persist facts → reply → (Phase 5: schedule).
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
  const inbound = await db.message.create({
    data: {
      leadId: lead.id,
      twilioMessageSid: messageSid,
      direction: "INBOUND",
      senderType: "CUSTOMER",
      body,
    },
  });

  // 5. Don't auto-reply if the customer opted out or the bot is paused
  //    (free-text "stop" detection arrives in Phase 6).
  if (lead.optedOut || lead.botPaused) {
    return twiml();
  }

  // 6. Run the conversation engine over the recent history.
  const recent = await db.message.findMany({
    where: { leadId: lead.id },
    orderBy: { createdAt: "asc" },
    take: HISTORY_LIMIT,
  });
  const history: ChatMessage[] = recent.map((m) => ({
    role: m.direction === "INBOUND" ? "user" : "assistant",
    content: m.body,
  }));

  const result = await processInboundMessage(lead, history);

  // 7. Persist extracted facts + new stage, and annotate the inbound message.
  const updatedLead = await db.lead.update({
    where: { id: lead.id },
    data: result.leadUpdates,
  });
  await db.message.update({
    where: { id: inbound.id },
    data: {
      detectedIntent: result.intent ?? undefined,
      extractedData: result.leadUpdates as unknown as Prisma.InputJsonValue,
    },
  });

  if (result.needsHumanReview) {
    await logEvent(lead.id, "safeguarding_flag", {
      riskLevel: result.riskLevel,
      flags: result.riskFlags,
    });
  }
  if (result.aiError) {
    await logEvent(lead.id, "external_api_failure", { where: "openai" });
  }

  // 8. Calendar booking turn (Phase 4). The route owns the calendar I/O; the
  //    handler generates any slot offer / confirmation from real availability.
  let replyText = result.reply;
  if (result.readyForBooking && !result.needsHumanReview) {
    const activeAppointment = await db.appointment.findFirst({
      where: { leadId: lead.id, status: "BOOKED" },
    });
    if (!activeAppointment) {
      const booking = await handleBookingTurn({
        lead: updatedLead,
        availability: result.availability,
        selectedSlotStart: result.selectedSlotStart,
      });
      if (booking.reply) replyText = booking.reply;
      if (booking.error) {
        await logEvent(lead.id, "external_api_failure", { where: "google_calendar" });
      }
      // (Phase 5 — intern) On booking.booked, schedule an APPOINTMENT_REMINDER
      // and cancel any INCOMPLETE_CONVERSATION follow-ups.
    }
  }

  // 9. Send the validated reply.
  if (replyText) {
    try {
      await sendWhatsAppMessage({
        leadId: lead.id,
        to: phone,
        body: replyText,
        senderType: "BOT",
        promptVersion: result.promptVersion,
        model: result.model,
      });
    } catch (error) {
      await logEvent(lead.id, "external_api_failure", {
        where: "twilio_send",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  // 10. TODO (Phase 5 — intern): based on result.nextStage / needsHumanReview,
  //     schedule or cancel ScheduledActions (INCOMPLETE_CONVERSATION reminder,
  //     APPOINTMENT_REMINDER on booking). Automated follow-ups must stay paused
  //     when needsHumanReview is true (spec §20) and be cancelled on opt-out.

  return twiml();
}
