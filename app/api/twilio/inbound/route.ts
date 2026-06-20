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
import { isOptOut, OPT_OUT_CONFIRMATION } from "@/lib/safety/opt-out";
import {
  isCancelAppointmentRequest,
  CANCEL_CONFIRMATION,
} from "@/lib/conversation/cancel-intent";
import { cancelCallback } from "@/lib/calendar/booking";
import { assessVulnerability } from "@/lib/safety/vulnerability";
import {
  scheduleIncompleteConversationFollowUp,
  scheduleAppointmentReminder,
  cancelPendingFollowUps,
} from "@/lib/scheduled-actions/process";

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
 * verify → dedup → load/create lead → store inbound →
 * opt-out gate (Phase 6) → pause gate →
 * vulnerability pre-scan (Phase 6) →
 * OpenAI conversation engine → persist facts → calendar turn (Phase 4) →
 * reply → schedule/cancel follow-ups (Phase 5).
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

  // 5a. Opt-out detection — MUST run before the AI call (spec §21, Phase 6).
  if (isOptOut(body)) {
    // Already opted out — just silently acknowledge (no double confirmation).
    if (lead.optedOut) return twiml();

    // Set opted out, stop all pending actions.
    await db.$transaction([
      db.lead.update({
        where: { id: lead.id },
        data: { optedOut: true, status: "STOPPED" },
      }),
      db.scheduledAction.updateMany({
        where: { leadId: lead.id, status: "PENDING" },
        data: { status: "CANCELLED" },
      }),
    ]);

    await logEvent(lead.id, "customer_opted_out", { trigger: body });

    // Send the single approved opt-out confirmation.
    try {
      await sendWhatsAppMessage({
        leadId: lead.id,
        to: phone,
        body: OPT_OUT_CONFIRMATION,
        senderType: "BOT",
      });
    } catch {
      /* log silently — we already recorded opted-out; don't block */
    }

    return twiml();
  }

  // 5b. If already opted out, silently drop (no confirmation re-send).
  if (lead.optedOut) return twiml();

  // 5c. Bot paused by Raf's team.
  if (lead.botPaused) return twiml();

  // 5c-bis. Customer wants to cancel their booked callback (NOT an opt-out).
  if (isCancelAppointmentRequest(body)) {
    const activeAppt = await db.appointment.findFirst({
      where: { leadId: lead.id, status: "BOOKED" },
      orderBy: { startAt: "desc" },
    });
    if (activeAppt) {
      try {
        await cancelCallback(activeAppt.id);
        await sendWhatsAppMessage({
          leadId: lead.id,
          to: phone,
          body: CANCEL_CONFIRMATION,
          senderType: "BOT",
        });
      } catch (error) {
        await logEvent(lead.id, "external_api_failure", {
          where: "cancel_callback",
          message: error instanceof Error ? error.message : String(error),
        });
        await sendWhatsAppMessage({
          leadId: lead.id,
          to: phone,
          body: "I'm having trouble cancelling that right now — a member of the team will sort it for you.",
          senderType: "BOT",
        }).catch(() => {});
      }
      return twiml();
    }
    // No active appointment to cancel — fall through to the normal conversation.
  }

  // 5d. Pre-scan the message body for vulnerability signals (Phase 6).
  // The AI's riskLevel is the primary signal; this catches clear keyword hits
  // that arrive before the AI has a chance to flag them.
  const vulnScan = assessVulnerability(body);
  if (vulnScan.level >= 2) {
    // Immediately mark the lead for human review and pause ordinary follow-ups.
    await db.lead.update({
      where: { id: lead.id },
      data: {
        status: "NEEDS_REVIEW",
        vulnerabilityLevel: Math.max(lead.vulnerabilityLevel, vulnScan.level),
        vulnerabilityFlags: Array.from(
          new Set([...lead.vulnerabilityFlags, ...vulnScan.flags])
        ),
      },
    });
    await logEvent(lead.id, "safeguarding_flag", {
      source: "keyword_scan",
      level: vulnScan.level,
      flags: vulnScan.flags,
    });
    // Cancel any ordinary follow-ups (spec §20 — ordinary follow-up pauses).
    await cancelPendingFollowUps(lead.id);
  }

  // Reload lead after potential vulnerability update.
  const freshLead = await db.lead.findUniqueOrThrow({ where: { id: lead.id } });

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

  const result = await processInboundMessage(freshLead, history);

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
      source: "openai",
      riskLevel: result.riskLevel,
      flags: result.riskFlags,
    });
  }
  if (result.aiError) {
    await logEvent(lead.id, "external_api_failure", { where: "openai" });
  }

  // Log review notes (fact conflicts, foreign-currency amounts) so the team can
  // see them — flagged rather than silently dropped/normalised.
  for (const note of result.notes) {
    await logEvent(lead.id, note.type, note.detail as Prisma.InputJsonValue);
  }

  // 8. Calendar booking turn (Phase 4). The route owns the calendar I/O; the
  //    handler generates any slot offer / confirmation from real availability.
  let replyText = result.reply;
  let bookingBooked = false;
  let bookedAppointmentStart: Date | null = null;

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
      if (booking.booked) {
        bookingBooked = true;
        // Find the appointment that was just created.
        const newAppt = await db.appointment.findFirst({
          where: { leadId: lead.id, status: "BOOKED" },
          orderBy: { createdAt: "desc" },
        });
        bookedAppointmentStart = newAppt?.startAt ?? null;
      }
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

  // 10. Phase 5 — schedule or cancel follow-ups.
  try {
    if (bookingBooked && bookedAppointmentStart) {
      // Appointment just confirmed → cancel any incomplete-conversation follow-ups
      // and schedule an appointment reminder.
      await cancelPendingFollowUps(lead.id);
      await scheduleAppointmentReminder(lead.id, bookedAppointmentStart);
    } else if (
      result.nextStage === "APPOINTMENT_BOOKED" ||
      result.nextStage === "COMPLETED" ||
      result.nextStage === "STOPPED" ||
      updatedLead.optedOut
    ) {
      // Closed states — cancel all pending follow-ups.
      await cancelPendingFollowUps(lead.id);
    } else if (!result.needsHumanReview && !updatedLead.botPaused) {
      // Active conversation — refresh the incomplete-conversation reminder
      // (the customer just replied, so we push the clock out).
      await scheduleIncompleteConversationFollowUp(lead.id);
    }
  } catch (err) {
    // Follow-up scheduling failure is non-fatal; the cron will pick it up.
    await logEvent(lead.id, "external_api_failure", {
      where: "schedule_follow_up",
      message: err instanceof Error ? err.message : String(err),
    });
  }

  return twiml();
}
