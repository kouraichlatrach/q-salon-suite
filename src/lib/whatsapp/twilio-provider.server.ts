/**
 * Twilio WhatsApp adapter.
 *
 * Calls Twilio's REST API directly with Basic auth, rather than going through
 * the Lovable connector gateway that `sms.server.ts` uses. That's deliberate:
 * we have real Twilio credentials for WhatsApp, and a direct call is one less
 * moving part between us and the provider. The gateway remains fine for SMS.
 *
 * Credentials are server-only and must never be VITE_-prefixed — anything
 * VITE_ ships in the browser bundle, and TWILIO_AUTH_TOKEN is account-level:
 * leaking it would let anyone send messages as this account.
 */

import { createHmac, timingSafeEqual } from "node:crypto";
import type {
  InboundVerification,
  SendWhatsAppInput,
  SendWhatsAppResult,
  WhatsAppProvider,
} from "./provider";

const API_BASE = "https://api.twilio.com/2010-04-01";

function env(name: string): string {
  return (process.env[name] || "").trim();
}

/** `whatsapp:+974…` — Twilio requires the channel prefix on both ends. */
function toWhatsAppAddress(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.startsWith("whatsapp:")) return trimmed;
  return `whatsapp:${trimmed.startsWith("+") ? trimmed : `+${trimmed.replace(/^0+/, "")}`}`;
}

export class TwilioWhatsAppProvider implements WhatsAppProvider {
  readonly name = "twilio";

  isConfigured(): boolean {
    return Boolean(
      env("TWILIO_ACCOUNT_SID") && env("TWILIO_AUTH_TOKEN") && env("TWILIO_WHATSAPP_NUMBER"),
    );
  }

  async send(input: SendWhatsAppInput): Promise<SendWhatsAppResult> {
    const sid = env("TWILIO_ACCOUNT_SID");
    const token = env("TWILIO_AUTH_TOKEN");
    const from = env("TWILIO_WHATSAPP_NUMBER");

    if (!sid || !token || !from) {
      const missing = [
        ...(!sid ? ["TWILIO_ACCOUNT_SID"] : []),
        ...(!token ? ["TWILIO_AUTH_TOKEN"] : []),
        ...(!from ? ["TWILIO_WHATSAPP_NUMBER"] : []),
      ].join(", ");
      // Soft failure, mirroring sendSms(): a missing integration must never
      // break a booking that has otherwise succeeded.
      console.warn(`[whatsapp] not configured (${missing}); would have messaged ${input.to}`);
      return { delivered: false, provider: "dev", reason: `not configured: ${missing}`, retryable: false };
    }

    const params = new URLSearchParams({
      To: toWhatsAppAddress(input.to),
      From: toWhatsAppAddress(from),
    });

    if (input.contentSid) {
      // Approved-template path — the only one valid for business-initiated
      // messages outside a 24h session window.
      params.set("ContentSid", input.contentSid);
      if (input.variables && Object.keys(input.variables).length > 0) {
        params.set("ContentVariables", JSON.stringify(input.variables));
      }
    } else if (input.body) {
      params.set("Body", input.body);
    } else {
      return {
        delivered: false,
        provider: this.name,
        reason: "no contentSid and no body supplied",
        retryable: false,
      };
    }

    let response: Response;
    try {
      response = await fetch(`${API_BASE}/Accounts/${sid}/Messages.json`, {
        method: "POST",
        headers: {
          Authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString("base64")}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: params,
      });
    } catch (err) {
      // Network-level failure is worth retrying; a 4xx generally isn't.
      return {
        delivered: false,
        provider: this.name,
        reason: err instanceof Error ? err.message : "network error",
        retryable: true,
      };
    }

    const text = await response.text();
    if (!response.ok) {
      let reason = text.slice(0, 500);
      try {
        const parsed = JSON.parse(text) as { message?: string; code?: number };
        if (parsed.message) reason = `${parsed.message}${parsed.code ? ` (code ${parsed.code})` : ""}`;
      } catch {
        /* keep the raw body */
      }
      console.error(`[whatsapp] Twilio send failed [${response.status}]: ${reason}`);
      return {
        delivered: false,
        provider: this.name,
        reason,
        // 5xx and 429 are transient; 4xx usually means bad number/template.
        retryable: response.status >= 500 || response.status === 429,
      };
    }

    const json = JSON.parse(text) as { sid?: string };
    return { delivered: true, provider: this.name, sid: json.sid ?? "" };
  }

  /**
   * Twilio signs inbound webhooks as base64(HMAC-SHA1(authToken, url + sorted
   * key/value pairs concatenated)). Verifying this is what stops anyone from
   * POSTing a fake "STOP" and opting a client out — or worse, a fake message
   * opting someone back in.
   */
  verifyInbound(
    url: string,
    rawBody: string,
    headers: Record<string, string>,
  ): InboundVerification {
    const token = env("TWILIO_AUTH_TOKEN");
    if (!token) return { valid: false, reason: "TWILIO_AUTH_TOKEN not configured" };

    const lower: Record<string, string> = {};
    for (const [k, v] of Object.entries(headers ?? {})) lower[k.toLowerCase()] = v;
    const signature = lower["x-twilio-signature"];
    if (!signature) return { valid: false, reason: "missing X-Twilio-Signature header" };

    const params = new URLSearchParams(rawBody);
    const fields: Record<string, string> = {};
    params.forEach((v, k) => {
      fields[k] = v;
    });

    const payload =
      url +
      Object.keys(fields)
        .sort()
        .map((k) => `${k}${fields[k]}`)
        .join("");

    const expected = createHmac("sha1", token).update(Buffer.from(payload, "utf-8")).digest("base64");

    const a = Buffer.from(expected);
    const b = Buffer.from(signature);
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      return { valid: false, reason: "signature mismatch" };
    }

    const from = (fields.From || "").replace(/^whatsapp:/, "");
    if (!from) return { valid: false, reason: "missing From" };

    return {
      valid: true,
      message: {
        from,
        body: fields.Body ?? "",
        messageSid: fields.MessageSid ?? fields.SmsMessageSid ?? "",
        raw: fields,
      },
    };
  }
}
