// Phone-number helpers for the WhatsApp channel.
// Twilio addresses WhatsApp numbers as "whatsapp:+447911123456". Internally we
// store the bare E.164 number on Lead.phoneNumber and only add the channel
// prefix when sending.

const WHATSAPP_PREFIX = /^whatsapp:/i;

/** Strip the "whatsapp:" channel prefix, returning a bare E.164 number. */
export function toE164(address: string): string {
  return address.trim().replace(WHATSAPP_PREFIX, "").trim();
}

/** Add the "whatsapp:" channel prefix expected by the Twilio API. */
export function toWhatsAppAddress(e164: string): string {
  return `whatsapp:${toE164(e164)}`;
}

/** Basic E.164 validation: leading "+", 7–15 digits, no leading zero. */
export function isValidE164(value: string): boolean {
  return /^\+[1-9]\d{6,14}$/.test(toE164(value));
}
