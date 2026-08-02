/**
 * Inbound WhatsApp webhook — opt-out ("STOP") handling.
 *
 * Why this exists even though Twilio auto-handles STOP:
 *
 * Twilio (and Meta) block further messages to a number that replies STOP at the
 * *platform* level, so compliance is technically satisfied without us. But the
 * platform doesn't tell our database. Without this handler, `whatsapp_opt_in`
 * would stay true forever: staff would see the client as opted in, the reminder
 * sweep would keep selecting them, and every send would silently fail at the
 * provider. We'd be generating failed-message noise and showing salon staff
 * something untrue about a client's wishes.
 *
 * So: Twilio enforces it, we mirror it, and the two stay in agreement.
 */

import { adminRpc } from "../booking.server";
import { getWhatsAppProvider } from "./index.server";
import { isOptInKeyword, isOptOutKeyword } from "./provider";

export { WHATSAPP_WEBHOOK_PATH } from "./webhook-path";

/** Twilio expects TwiML or an empty 200; anything else is logged as an error. */
function twiml(body = ""): Response {
  return new Response(
    `<?xml version="1.0" encoding="UTF-8"?><Response>${body}</Response>`,
    { status: 200, headers: { "content-type": "text/xml" } },
  );
}

export async function handleWhatsAppWebhook(request: Request): Promise<Response> {
  if (request.method !== "POST") {
    return new Response(JSON.stringify({ error: "method_not_allowed" }), {
      status: 405,
      headers: { "content-type": "application/json" },
    });
  }

  const rawBody = await request.text();
  const headers: Record<string, string> = {};
  request.headers.forEach((v, k) => {
    headers[k] = v;
  });

  const provider = getWhatsAppProvider();

  // Twilio signs over the exact public URL it called. Behind a proxy the
  // inbound URL can differ from what Twilio used, so allow an explicit
  // override rather than silently failing verification.
  const publicBase = (process.env.APP_BASE_URL || "").replace(/\/$/, "");
  const url = publicBase
    ? `${publicBase}${new URL(request.url).pathname}`
    : request.url;

  const verified = provider.verifyInbound(url, rawBody, headers);

  if (!verified.valid) {
    // Refuse unverified payloads: accepting them would let anyone opt a client
    // out — or, worse, forge an opt-IN and generate unconsented messaging.
    console.warn(`[whatsapp] inbound rejected: ${verified.reason}`);
    try {
      await adminRpc("whatsapp_log_message", {
        _brand_id: null,
        _appointment_id: null,
        _client_id: null,
        _kind: "inbound_rejected",
        _to_phone: "unknown",
        _provider: provider.name,
        _provider_sid: null,
        _status: "rejected",
        _error_message: verified.reason,
        _body_preview: rawBody.slice(0, 500),
      });
    } catch {
      /* logging must not mask the rejection */
    }
    return new Response(JSON.stringify({ error: "invalid_signature" }), {
      status: 403,
      headers: { "content-type": "application/json" },
    });
  }

  const { from, body } = verified.message;

  try {
    if (isOptOutKeyword(body)) {
      const rows = await adminRpc<Array<{ clients_updated: number }>>(
        "whatsapp_opt_out_by_phone",
        { _phone: from },
      );
      const n = rows?.[0]?.clients_updated ?? 0;
      console.info(`[whatsapp] STOP from ${from}: opted out ${n} client record(s)`);
      // No reply body: Twilio sends its own opt-out confirmation, and sending
      // ours on top would both duplicate it and be a message to someone who
      // just asked us to stop messaging them.
      return twiml();
    }

    if (isOptInKeyword(body)) {
      const rows = await adminRpc<Array<{ clients_updated: number }>>(
        "whatsapp_opt_in_by_phone",
        { _phone: from },
      );
      const n = rows?.[0]?.clients_updated ?? 0;
      console.info(`[whatsapp] START from ${from}: opted in ${n} client record(s)`);
      return twiml();
    }

    // Anything else is a client replying conversationally. Two-way messaging is
    // explicitly out of scope (Section 8, lower priority), so acknowledge
    // silently rather than auto-replying something unhelpful.
    return twiml();
  } catch (err) {
    console.error("[whatsapp] inbound processing failed", err);
    // 500 so Twilio retries — the signature was valid, so this is our fault.
    return new Response(JSON.stringify({ error: "processing_failed" }), {
      status: 500,
      headers: { "content-type": "application/json" },
    });
  }
}
