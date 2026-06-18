import { describe, it, expect } from "vitest";
import crypto from "node:crypto";
import {
  buildWebhookUrl,
  verifyTwilioSignature,
} from "@/lib/twilio/verify-signature";

// Reproduce Twilio's signing algorithm: HMAC-SHA1 over the URL followed by the
// POST params sorted by key and concatenated as key+value, base64-encoded.
function twilioSign(
  authToken: string,
  url: string,
  params: Record<string, string>
): string {
  const data =
    url +
    Object.keys(params)
      .sort()
      .map((key) => key + params[key])
      .join("");
  return crypto
    .createHmac("sha1", authToken)
    .update(Buffer.from(data, "utf-8"))
    .digest("base64");
}

const TOKEN = "test_auth_token_123";
const URL = "https://example.com/api/twilio/inbound";
const PARAMS = {
  From: "whatsapp:+447911123456",
  To: "whatsapp:+14155238886",
  Body: "Hello there",
  MessageSid: "SM1234567890",
};

describe("verifyTwilioSignature", () => {
  it("accepts a correctly signed request", () => {
    const signature = twilioSign(TOKEN, URL, PARAMS);
    expect(
      verifyTwilioSignature({
        signature,
        url: URL,
        params: PARAMS,
        authToken: TOKEN,
      })
    ).toBe(true);
  });

  it("rejects a tampered body", () => {
    const signature = twilioSign(TOKEN, URL, PARAMS);
    expect(
      verifyTwilioSignature({
        signature,
        url: URL,
        params: { ...PARAMS, Body: "Tampered" },
        authToken: TOKEN,
      })
    ).toBe(false);
  });

  it("rejects an empty signature", () => {
    expect(
      verifyTwilioSignature({
        signature: "",
        url: URL,
        params: PARAMS,
        authToken: TOKEN,
      })
    ).toBe(false);
  });

  it("rejects a wrong auth token", () => {
    const signature = twilioSign("a_different_token", URL, PARAMS);
    expect(
      verifyTwilioSignature({
        signature,
        url: URL,
        params: PARAMS,
        authToken: TOKEN,
      })
    ).toBe(false);
  });
});

describe("buildWebhookUrl", () => {
  it("builds from proto + host + pathname", () => {
    expect(
      buildWebhookUrl({
        proto: "https",
        host: "raf.up.railway.app",
        pathname: "/api/twilio/inbound",
      })
    ).toBe("https://raf.up.railway.app/api/twilio/inbound");
  });

  it("prefers the base override and trims a trailing slash", () => {
    expect(
      buildWebhookUrl({
        baseOverride: "https://custom.example.com/",
        proto: "http",
        host: "internal",
        pathname: "/api/twilio/status",
      })
    ).toBe("https://custom.example.com/api/twilio/status");
  });
});
