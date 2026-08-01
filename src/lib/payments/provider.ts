/**
 * Payment provider abstraction (Payments Phase A, Section 9).
 *
 * Nothing outside `src/lib/payments/` should import a provider implementation
 * directly — call `getPaymentProvider()` and work against this interface. The
 * point is that swapping MockPaymentProvider for a real DibsyPaymentProvider is
 * a contained change: one new file plus a branch in the factory.
 *
 * Two deliberate design choices make that swap possible:
 *
 * 1. Webhook events are *normalised* into `NormalizedWebhookEvent` by the
 *    provider itself. Callers never see provider-shaped JSON, so a different
 *    payload shape from Dibsy stays behind the adapter boundary.
 * 2. Idempotency keys are supplied by *us*, not the provider (Section 7
 *    requires them on every payment-writing operation). Providers that generate
 *    their own reference still receive ours to echo back.
 *
 * This file is import-safe from client code: types only, no secrets, no Node
 * APIs. Implementations live in `*.server.ts` siblings.
 */

/** Minor-unit-free amount. QAR has 2 decimals; we keep numeric(10,2) in the DB. */
export type ChargeIntent = {
  /** Ours, not the provider's. Replaying the same key must not double-charge. */
  idempotencyKey: string;
  amount: number;
  currency: string;
  /** Shown on the provider's hosted checkout where supported. */
  description: string;
  /**
   * Where the client is sent after paying. Cosmetic only — per the cross-phase
   * architecture rule, a redirect back is never treated as proof of payment.
   */
  returnUrl: string;
  /** Correlation data echoed back on the webhook (appointment id, brand id). */
  metadata: Record<string, string>;
};

export type ChargeResult =
  | {
      ok: true;
      /** The provider's own id for this charge. Stored as payments.provider_ref. */
      providerRef: string;
      /** Hosted checkout URL the client is sent to. */
      checkoutUrl: string;
    }
  | { ok: false; error: string };

export type RefundIntent = {
  idempotencyKey: string;
  /** provider_ref of the original charge being reversed. */
  chargeRef: string;
  amount: number;
  currency: string;
  reason: string;
};

export type RefundResult =
  | { ok: true; providerRef: string }
  | { ok: false; error: string };

/** Provider-neutral webhook event. Adapters map their own payloads onto this. */
export type NormalizedWebhookEvent = {
  /** provider_ref of the charge or refund this event concerns. */
  providerRef: string;
  type:
    | "charge.succeeded"
    | "charge.failed"
    | "refund.succeeded"
    | "refund.failed";
  amount: number | null;
  currency: string | null;
  /** Echoed metadata from the original intent, where the provider supports it. */
  metadata: Record<string, string>;
  /** Original payload, persisted verbatim to the append-only audit log. */
  raw: unknown;
};

export type WebhookVerification =
  | { valid: true; event: NormalizedWebhookEvent }
  | { valid: false; reason: string };

export interface PaymentProvider {
  /** Stored on every payments row so mixed-provider history stays readable. */
  readonly name: string;
  createCharge(intent: ChargeIntent): Promise<ChargeResult>;
  /**
   * Verifies signature over the RAW request body. Must be given the exact bytes
   * received — re-serialising parsed JSON will break signature comparison.
   */
  verifyWebhookSignature(
    rawBody: string,
    headers: Record<string, string>,
  ): WebhookVerification;
  refund(intent: RefundIntent): Promise<RefundResult>;
}
