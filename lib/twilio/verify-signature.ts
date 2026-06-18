import twilio from "twilio";
import { env } from "@/lib/env";

// Verify the X-Twilio-Signature header so we only act on webhooks genuinely
// sent by Twilio (spec §22). Twilio signs over the exact public URL it called
// plus the sorted POST parameters, using the account auth token.

/**
 * Reconstruct the public URL Twilio used to reach this webhook.
 * Behind Railway's proxy the request protocol can read as http internally, so
 * we trust x-forwarded-proto / host. A TWILIO_WEBHOOK_BASE_URL override wins
 * when set (useful if the configured webhook URL differs from the host header).
 */
export function buildWebhookUrl(input: {
  baseOverride?: string;
  proto: string;
  host: string;
  pathname: string;
}): string {
  const base = input.baseOverride?.trim() || `${input.proto}://${input.host}`;
  return `${base.replace(/\/+$/, "")}${input.pathname}`;
}

export function verifyTwilioSignature(args: {
  signature: string;
  url: string;
  params: Record<string, string>;
  authToken?: string;
}): boolean {
  if (!args.signature) return false;
  const token = args.authToken ?? env.twilio.authToken;
  return twilio.validateRequest(token, args.signature, args.url, args.params);
}
