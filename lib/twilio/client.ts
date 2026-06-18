import twilio, { type Twilio } from "twilio";
import { env } from "@/lib/env";

// Lazily-created Twilio REST client. Created on first use so the app can boot
// (e.g. serve /login) without Twilio credentials present during early dev.
let client: Twilio | undefined;

export function twilioClient(): Twilio {
  if (!client) {
    client = twilio(env.twilio.accountSid, env.twilio.authToken);
  }
  return client;
}
