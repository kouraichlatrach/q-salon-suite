/**
 * Deposit orchestration: the seam between provider I/O and DB state.
 *
 * Rule of thumb used throughout: the database decides *what should happen*, the
 * provider call *makes it happen*, and the database records *what did happen*.
 * Nothing here interprets money rules — those live in the RPCs.
 */

import { adminRpc } from "../booking.server";
import { getPaymentProvider } from "./index.server";

export type OpenDepositChargeResult =
  | { ok: true; checkoutUrl: string; providerRef: string; paymentId: string }
  | { ok: false; error: string };

/**
 * Creates the provider charge and records it as a pending payment row.
 *
 * The provider call happens first so a failure there leaves no orphan payment
 * row; the DB row is only written once we have a real provider reference.
 */
export async function openDepositCharge(opts: {
  brandId: string;
  appointmentId: string;
  amount: number;
  currency: string;
  description: string;
  returnUrl: string;
  /** Distinguishes retries of the same appointment's deposit. */
  attempt: number;
}): Promise<OpenDepositChargeResult> {
  const provider = getPaymentProvider();
  // Deterministic per (appointment, attempt): a double-submit of the same
  // attempt collapses to one payment row via the unique idempotency_key.
  const idempotencyKey = `dep_charge_${opts.appointmentId}_${opts.attempt}`;

  const charge = await provider.createCharge({
    idempotencyKey,
    amount: opts.amount,
    currency: opts.currency,
    description: opts.description,
    returnUrl: opts.returnUrl,
    metadata: {
      appointment_id: opts.appointmentId,
      brand_id: opts.brandId,
      kind: "deposit",
    },
  });

  if (!charge.ok) return { ok: false, error: charge.error };

  const paymentId = await adminRpc<string>("payment_open_charge", {
    _brand_id: opts.brandId,
    _appointment_id: opts.appointmentId,
    _provider: provider.name,
    _provider_ref: charge.providerRef,
    _amount: opts.amount,
    _currency: opts.currency,
    _idempotency_key: idempotencyKey,
  });

  return {
    ok: true,
    checkoutUrl: charge.checkoutUrl,
    providerRef: charge.providerRef,
    paymentId: paymentId as unknown as string,
  };
}

/** Shape returned by public_cancel_by_token. */
export type CancellationOutcome = {
  ok: boolean;
  appointment_id: string | null;
  brand_id: string | null;
  refund_due: boolean;
  refund_amount: number | null;
  currency: string | null;
  charge_ref: string | null;
  charge_id: string | null;
  outcome: string;
};

/**
 * Executes a refund the DB has already decided is owed (spec item 6: automatic,
 * no manual approval). Records the result either way — a failed refund must be
 * as visible as a successful one, since someone is owed money.
 */
export async function executeRefundIfDue(
  cancellation: CancellationOutcome,
): Promise<{ refunded: boolean; error?: string }> {
  if (!cancellation.refund_due || !cancellation.appointment_id) {
    return { refunded: false };
  }
  if (!cancellation.charge_ref || !cancellation.charge_id || !cancellation.refund_amount) {
    return { refunded: false, error: "missing charge reference" };
  }

  const provider = getPaymentProvider();
  // One refund per charge, forever — replay-safe by construction.
  const idempotencyKey = `dep_refund_${cancellation.appointment_id}_${cancellation.charge_id}`;

  const result = await provider.refund({
    idempotencyKey,
    chargeRef: cancellation.charge_ref,
    amount: cancellation.refund_amount,
    currency: cancellation.currency ?? "QAR",
    reason: "client_cancelled_before_cutoff",
  });

  await adminRpc("payment_record_refund", {
    _brand_id: cancellation.brand_id,
    _appointment_id: cancellation.appointment_id,
    _parent_payment_id: cancellation.charge_id,
    _provider: provider.name,
    _provider_ref: result.ok ? result.providerRef : null,
    _amount: cancellation.refund_amount,
    _currency: cancellation.currency ?? "QAR",
    _idempotency_key: idempotencyKey,
    _succeeded: result.ok,
    _failure_reason: result.ok ? null : result.error,
  });

  return result.ok ? { refunded: true } : { refunded: false, error: result.error };
}
