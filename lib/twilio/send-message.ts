import type { Message, SenderType } from "@prisma/client";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { twilioClient } from "@/lib/twilio/client";
import { isValidE164, toWhatsAppAddress } from "@/lib/twilio/phone";

type SendArgs = {
  leadId: string;
  /** Bare E.164 recipient number, e.g. "+447911123456". */
  to: string;
  body: string;
  senderType?: SenderType; // BOT (default) or HUMAN
  promptVersion?: string;
  model?: string;
};

/**
 * Send an outbound WhatsApp message and persist the resulting Message row.
 * Never sends to a number that is not valid E.164 (spec §19.1: never message an
 * unverified number). The persisted row carries the Twilio SID so the status
 * callback can later update its delivery status.
 */
export async function sendWhatsAppMessage(args: SendArgs): Promise<Message> {
  if (!isValidE164(args.to)) {
    throw new Error(`Refusing to send to invalid number: ${args.to}`);
  }
  if (!args.body.trim()) {
    throw new Error("Refusing to send an empty message body");
  }

  const sent = await twilioClient().messages.create({
    from: env.twilio.whatsappNumber, // already includes the "whatsapp:" prefix
    to: toWhatsAppAddress(args.to),
    body: args.body,
  });

  const message = await db.message.create({
    data: {
      leadId: args.leadId,
      twilioMessageSid: sent.sid,
      direction: "OUTBOUND",
      senderType: args.senderType ?? "BOT",
      body: args.body,
      deliveryStatus: sent.status,
      promptVersion: args.promptVersion,
      model: args.model,
    },
  });

  await db.lead.update({
    where: { id: args.leadId },
    data: { lastBotMessageAt: new Date() },
  });

  return message;
}
