/**
 * SMS adapter for the public booking portal.
 *
 * Provider-agnostic: everything in the booking flow calls `sendSms()` and never
 * touches a provider SDK. Today it routes through the Lovable connector gateway
 * to Twilio. If no Twilio connection is linked yet, it degrades gracefully to a
 * dev-mode log so the booking flow stays testable end-to-end.
 */

const GATEWAY_URL = "https://connector-gateway.lovable.dev/twilio";

export type SmsResult =
  | { delivered: true; provider: "twilio"; sid: string }
  | { delivered: false; provider: "dev"; reason: string };

export function isSmsConfigured(): boolean {
  return Boolean(
    process.env.LOVABLE_API_KEY &&
      process.env.TWILIO_API_KEY &&
      (process.env.TWILIO_FROM_NUMBER || "").trim(),
  );
}

/**
 * Sends an SMS. Never throws for "not configured" — callers should treat a
 * `delivered: false` result as a soft failure and surface the code another way
 * (dev) or a "couldn't send" notice (prod).
 */
export async function sendSms(opts: {
  to: string;
  body: string;
  from?: string | null;
}): Promise<SmsResult> {
  const lovableKey = process.env.LOVABLE_API_KEY;
  const twilioKey = process.env.TWILIO_API_KEY;
  const from = (opts.from || process.env.TWILIO_FROM_NUMBER || "").trim();

  if (!lovableKey || !twilioKey || !from) {
    const missing = [
      ...(!lovableKey ? ["LOVABLE_API_KEY"] : []),
      ...(!twilioKey ? ["TWILIO_API_KEY (link the Twilio connector)"] : []),
      ...(!from ? ["TWILIO_FROM_NUMBER"] : []),
    ].join(", ");
    console.warn(`[sms] not configured (${missing}); would have sent to ${opts.to}`);
    return { delivered: false, provider: "dev", reason: missing };
  }

  const response = await fetch(`${GATEWAY_URL}/Messages.json`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${lovableKey}`,
      "X-Connection-Api-Key": twilioKey,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({ To: opts.to, From: from, Body: opts.body }),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    console.error(`[sms] Twilio request failed [${response.status}]: ${errorBody}`);
    throw new Error(`SMS provider failed [${response.status}]: ${errorBody}`);
  }

  const json = (await response.json()) as { sid?: string };
  return { delivered: true, provider: "twilio", sid: json.sid ?? "" };
}
