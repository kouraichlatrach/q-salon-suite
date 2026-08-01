/**
 * Payment webhook handler.
 *
 * Per the cross-phase architecture rule (Section 9): a signature-verified,
 * server-to-server webhook is the ONLY thing that ever marks a payment as
 * succeeded. Client-side redirects back from checkout are cosmetic. This closes
 * the payment-bypass hole where a spoofed redirect URL would otherwise be
 * treated as proof of payment.
 *
 * Mounted directly on the fetch handler in `src/server.ts` rather than as a
 * route component, because signature verification needs the exact raw bytes of
 * the request body — anything that parses and re-serialises JSON first would
 * change whitespace/key order and break the MAC.
 */

import { adminRpc } from "../booking.server";
import { getPaymentProvider } from "./index.server";

export { PAYMENT_WEBHOOK_PATH } from "./webhook-path";

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

export async function handlePaymentWebhook(request: Request): Promise<Response> {
  if (request.method !== "POST") {
    return json(405, { error: "method_not_allowed" });
  }

  // Raw body first, before anything can touch it.
  const rawBody = await request.text();
  const headers: Record<string, string> = {};
  request.headers.forEach((v, k) => {
    headers[k] = v;
  });

  const provider = getPaymentProvider();
  const verified = provider.verifyWebhookSignature(rawBody, headers);

  if (!verified.valid) {
    // Record the rejection so forged/misconfigured senders leave an audit trail.
    // Body is truncated: it is untrusted input and may be large.
    try {
      await adminRpc("payment_log_event", {
        _payment_id: null,
        _appointment_id: null,
        _event_type: "webhook.rejected",
        _signature_verified: false,
        _payload: { reason: verified.reason, body: rawBody.slice(0, 2000) },
      });
    } catch {
      // Logging must never mask the rejection itself.
    }
    console.warn(`[payments] webhook rejected: ${verified.reason}`);
    // 400, not 200: a real provider should see this as a delivery failure.
    return json(400, { error: "invalid_signature", reason: verified.reason });
  }

  const event = verified.event;

  try {
    if (event.type === "charge.succeeded") {
      const rows = await adminRpc<
        Array<{ applied: boolean; appointment_id: string | null; reason: string | null }>
      >("payment_confirm_charge", {
        _provider: provider.name,
        _provider_ref: event.providerRef,
        _amount: event.amount,
        _payload: event.raw,
      });
      const r = rows?.[0];
      // A duplicate delivery is a success from the provider's perspective —
      // returning non-2xx would make it retry forever.
      return json(200, {
        received: true,
        applied: r?.applied ?? false,
        reason: r?.reason ?? null,
      });
    }

    if (event.type === "charge.failed") {
      const rows = await adminRpc<
        Array<{ applied: boolean; appointment_id: string | null; reason: string | null }>
      >("payment_fail_charge", {
        _provider: provider.name,
        _provider_ref: event.providerRef,
        _reason: "provider_reported_failure",
        _payload: event.raw,
      });
      const r = rows?.[0];
      return json(200, { received: true, applied: r?.applied ?? false, reason: r?.reason ?? null });
    }

    // Refund events: our refund flow is synchronous (the API call returns a
    // result we record immediately), so an async refund webhook is currently
    // informational only. Logged, acknowledged, no state change.
    await adminRpc("payment_log_event", {
      _payment_id: null,
      _appointment_id: null,
      _event_type: `webhook.${event.type}`,
      _signature_verified: true,
      _payload: event.raw,
    });
    return json(200, { received: true, applied: false, reason: "informational" });
  } catch (err) {
    console.error("[payments] webhook processing failed", err);
    // 500 so the provider retries — the signature was valid, so this is our bug.
    return json(500, { error: "processing_failed" });
  }
}
