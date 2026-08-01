/**
 * MockPaymentProvider — a developer testing stand-in for a real gateway.
 *
 * Deliberately NOT a no-op stub. The signature scheme below is real HMAC-SHA256
 * with timestamp-based replay protection, so the production webhook-verification
 * path is genuinely exercised rather than bypassed. The only thing faked is the
 * money movement itself.
 *
 * `createCharge()` returns a checkout URL pointing at our own local test page
 * (`/dev/mock-checkout`), where a developer can click "succeeded" or "failed";
 * that page then posts a correctly-signed payload to the real webhook endpoint.
 */

import { createHmac, timingSafeEqual, randomBytes } from "node:crypto";
import type {
  ChargeIntent,
  ChargeResult,
  NormalizedWebhookEvent,
  PaymentProvider,
  RefundIntent,
  RefundResult,
  WebhookVerification,
} from "./provider";

const DEV_SECRET_FALLBACK = "mock_whsec_dev_only_not_a_real_secret";
/** Reject payloads older than this, mirroring real providers' replay windows. */
const SIGNATURE_TOLERANCE_SECONDS = 300;

export function mockWebhookSecret(): string {
  return process.env.MOCK_PAYMENT_WEBHOOK_SECRET || DEV_SECRET_FALLBACK;
}

function appBaseUrl(): string {
  return (
    process.env.APP_BASE_URL ||
    process.env.VITE_APP_BASE_URL ||
    "http://localhost:8080"
  ).replace(/\/$/, "");
}

/** Signs `${timestamp}.${body}` — timestamp is inside the MAC, so it can't be edited. */
export function signMockPayload(
  rawBody: string,
  timestampSeconds: number,
  secret = mockWebhookSecret(),
): string {
  const mac = createHmac("sha256", secret)
    .update(`${timestampSeconds}.${rawBody}`)
    .digest("hex");
  return `t=${timestampSeconds},v1=${mac}`;
}

function safeEqualHex(a: string, b: string): boolean {
  // Compare as bytes, and only when lengths match — timingSafeEqual throws otherwise.
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex"));
  } catch {
    return false;
  }
}

export class MockPaymentProvider implements PaymentProvider {
  readonly name = "mock";

  async createCharge(intent: ChargeIntent): Promise<ChargeResult> {
    if (!(intent.amount > 0)) {
      return { ok: false, error: "amount must be greater than zero" };
    }
    // Shaped like a provider id so log/DB output looks realistic.
    const providerRef = `mock_ch_${randomBytes(12).toString("hex")}`;

    const url = new URL(`${appBaseUrl()}/dev/mock-checkout`);
    url.searchParams.set("ref", providerRef);
    url.searchParams.set("amount", intent.amount.toFixed(2));
    url.searchParams.set("currency", intent.currency);
    url.searchParams.set("description", intent.description);
    url.searchParams.set("return_url", intent.returnUrl);
    // Round-tripped so the webhook can echo metadata back, as a real provider would.
    url.searchParams.set("metadata", JSON.stringify(intent.metadata ?? {}));

    console.info(
      `[payments:mock] createCharge ref=${providerRef} amount=${intent.amount} ${intent.currency} idem=${intent.idempotencyKey}`,
    );
    return { ok: true, providerRef, checkoutUrl: url.toString() };
  }

  verifyWebhookSignature(
    rawBody: string,
    headers: Record<string, string>,
  ): WebhookVerification {
    // Header lookup is case-insensitive: Node lowercases, browsers/proxies vary.
    const lower: Record<string, string> = {};
    for (const [k, v] of Object.entries(headers ?? {})) lower[k.toLowerCase()] = v;
    const header = lower["x-mock-signature"];
    if (!header) return { valid: false, reason: "missing x-mock-signature header" };

    const parts = Object.fromEntries(
      header.split(",").map((p) => {
        const i = p.indexOf("=");
        return [p.slice(0, i).trim(), p.slice(i + 1).trim()];
      }),
    ) as { t?: string; v1?: string };

    if (!parts.t || !parts.v1) {
      return { valid: false, reason: "malformed signature header" };
    }

    const ts = Number(parts.t);
    if (!Number.isFinite(ts)) {
      return { valid: false, reason: "invalid signature timestamp" };
    }
    const ageSeconds = Math.abs(Date.now() / 1000 - ts);
    if (ageSeconds > SIGNATURE_TOLERANCE_SECONDS) {
      return { valid: false, reason: `signature timestamp outside tolerance (${Math.round(ageSeconds)}s)` };
    }

    const expected = createHmac("sha256", mockWebhookSecret())
      .update(`${ts}.${rawBody}`)
      .digest("hex");
    if (!safeEqualHex(expected, parts.v1)) {
      return { valid: false, reason: "signature mismatch" };
    }

    let parsed: {
      ref?: string;
      type?: string;
      amount?: number;
      currency?: string;
      metadata?: Record<string, string>;
    };
    try {
      parsed = JSON.parse(rawBody);
    } catch {
      return { valid: false, reason: "body is not valid JSON" };
    }

    const allowed: NormalizedWebhookEvent["type"][] = [
      "charge.succeeded",
      "charge.failed",
      "refund.succeeded",
      "refund.failed",
    ];
    if (!parsed.ref || !parsed.type || !allowed.includes(parsed.type as never)) {
      return { valid: false, reason: `unsupported or incomplete event: ${parsed.type ?? "(none)"}` };
    }

    return {
      valid: true,
      event: {
        providerRef: parsed.ref,
        type: parsed.type as NormalizedWebhookEvent["type"],
        amount: typeof parsed.amount === "number" ? parsed.amount : null,
        currency: parsed.currency ?? null,
        metadata: parsed.metadata ?? {},
        raw: parsed,
      },
    };
  }

  async refund(intent: RefundIntent): Promise<RefundResult> {
    if (!intent.chargeRef) return { ok: false, error: "missing charge reference" };
    if (!(intent.amount > 0)) return { ok: false, error: "amount must be greater than zero" };

    const providerRef = `mock_re_${randomBytes(12).toString("hex")}`;
    // Logged as if real; the caller still writes the payments row + audit event,
    // so idempotency and audit discipline are identical to a live provider.
    console.info(
      `[payments:mock] refund ref=${providerRef} charge=${intent.chargeRef} amount=${intent.amount} ${intent.currency} reason="${intent.reason}" idem=${intent.idempotencyKey}`,
    );
    return { ok: true, providerRef };
  }
}
