/**
 * WhatsApp messaging service — the layer between app events and the provider.
 *
 * Responsibilities, in order:
 *   1. Refuse to send without consent (Section 10 item 1 — a policy
 *      requirement, not a preference; unsolicited messaging risks the sender
 *      being restricted by Meta for every brand at once).
 *   2. Resolve the brand's approved template for this message kind.
 *   3. Send via the adapter.
 *   4. Record the attempt, successful or not.
 *
 * Every send is logged even when it fails, because "the client says they never
 * got it" is the question this table exists to answer.
 */

import { adminRpc } from "../booking.server";
import { getWhatsAppProvider } from "./index.server";
import type { WhatsAppMessageKind } from "./provider";

export type DispatchResult =
  | { sent: true; sid: string }
  | { sent: false; reason: string };

type TemplateRow = { content_sid: string | null; is_active: boolean };

async function resolveTemplate(
  brandId: string,
  kind: WhatsAppMessageKind,
): Promise<TemplateRow | null> {
  const rows = await adminRpc<TemplateRow[]>("whatsapp_get_template", {
    _brand_id: brandId,
    _kind: kind,
  });
  return rows?.[0] ?? null;
}

/**
 * Sends a WhatsApp message for an appointment, if and only if the client has
 * opted in. Never throws: a messaging failure must not break the booking or the
 * reminder sweep that called it.
 */
export async function dispatchAppointmentMessage(opts: {
  brandId: string;
  appointmentId: string;
  clientId: string;
  kind: WhatsAppMessageKind;
  toPhone: string;
  /** Ordered template variables, keyed "1", "2", … */
  variables: Record<string, string>;
  /** Human-readable equivalent, used as fallback body and for the audit log. */
  preview: string;
}): Promise<DispatchResult> {
  const provider = getWhatsAppProvider();

  async function log(status: string, sid: string | null, error: string | null) {
    try {
      await adminRpc("whatsapp_log_message", {
        _brand_id: opts.brandId,
        _appointment_id: opts.appointmentId,
        _client_id: opts.clientId,
        _kind: opts.kind,
        _to_phone: opts.toPhone,
        _provider: provider.name,
        _provider_sid: sid,
        _status: status,
        _error_message: error,
        _body_preview: opts.preview,
      });
    } catch (err) {
      // Logging must never be the thing that breaks a send.
      console.error("[whatsapp] failed to write message log", err);
    }
  }

  if (!provider.isConfigured()) {
    await log("skipped", null, "provider not configured");
    return { sent: false, reason: "provider not configured" };
  }

  const template = await resolveTemplate(opts.brandId, opts.kind);
  if (template && !template.is_active) {
    await log("skipped", null, "template disabled for brand");
    return { sent: false, reason: "template disabled" };
  }

  const result = await provider.send({
    to: opts.toPhone,
    kind: opts.kind,
    contentSid: template?.content_sid ?? null,
    variables: opts.variables,
    // Only delivers inside an open session window; production always needs a
    // template. Kept so sandbox testing works before templates are approved.
    body: opts.preview,
  });

  if (result.delivered) {
    await log("sent", result.sid, null);
    return { sent: true, sid: result.sid };
  }

  await log("failed", null, result.reason);
  console.warn(`[whatsapp] ${opts.kind} not delivered to ${opts.toPhone}: ${result.reason}`);
  return { sent: false, reason: result.reason };
}

/**
 * Records consent from a booking and, if granted, sends the confirmation.
 *
 * Lives here rather than beside `confirmBooking` because modules declaring
 * `createServerFn` are split at build time — a sibling helper in that file
 * becomes a runtime ReferenceError.
 *
 * Never throws. Messaging is best-effort: the booking is already durable by the
 * time this runs, and a provider outage must not surface as a booking failure.
 */
export async function recordConsentAndConfirm(opts: {
  appointmentId: string;
  brandId: string;
  token: string;
  optIn: boolean;
  source: "public_booking" | "staff_booking";
  /**
   * Deposit bookings are only `pending` at this point — the slot is held but
   * the payment hasn't cleared, so "your booking is confirmed" would be a lie.
   * Consent is still recorded now (the client did tick the box); the message
   * itself waits for the payment webhook.
   */
  sendConfirmation?: boolean;
}): Promise<{ consented: boolean; sent: boolean; reason?: string }> {
  try {
    const rows = await adminRpc<Array<{ client_id: string | null; opted_in: boolean }>>(
      "whatsapp_consent_from_booking",
      {
        _appointment_id: opts.appointmentId,
        _opt_in: opts.optIn,
        _source: opts.source,
      },
    );
    const consent = rows?.[0];
    if (!consent?.client_id || !consent.opted_in) {
      return { consented: Boolean(consent?.opted_in), sent: false, reason: "no consent" };
    }

    if (opts.sendConfirmation === false) {
      return { consented: true, sent: false, reason: "confirmation deferred to payment" };
    }

    // Read the appointment back through the token RPC rather than threading a
    // dozen fields through the caller — it already returns everything the
    // message needs, resolved and joined.
    const appts = await adminRpc<
      Array<{
        client_name: string;
        phone: string | null;
        service_name: string | null;
        location_name: string;
        starts_at: string;
      }>
    >("public_get_appointment_by_token", { _token: opts.token });
    const appt = appts?.[0];
    if (!appt?.phone) return { consented: true, sent: false, reason: "no phone on record" };

    const { variables, preview } = buildConfirmationMessage({
      clientName: appt.client_name,
      serviceName: appt.service_name ?? "your appointment",
      whenText: new Date(appt.starts_at).toUTCString(),
      locationName: appt.location_name,
    });

    const result = await dispatchAppointmentMessage({
      brandId: opts.brandId,
      appointmentId: opts.appointmentId,
      clientId: consent.client_id,
      kind: "booking_confirmation",
      toPhone: appt.phone,
      variables,
      preview,
    });

    return result.sent
      ? { consented: true, sent: true }
      : { consented: true, sent: false, reason: result.reason };
  } catch (err) {
    console.error("[whatsapp] confirmation flow failed (booking unaffected)", err);
    return { consented: false, sent: false, reason: "internal error" };
  }
}

/** Formats the confirmation variables + preview from appointment details. */
export function buildConfirmationMessage(a: {
  clientName: string;
  serviceName: string;
  whenText: string;
  locationName: string;
}) {
  return {
    variables: { "1": a.clientName, "2": a.serviceName, "3": a.whenText, "4": a.locationName },
    preview:
      `Hi ${a.clientName}, your booking is confirmed.\n\n` +
      `Service: ${a.serviceName}\nWhen: ${a.whenText}\nWhere: ${a.locationName}\n\n` +
      `Reply STOP to opt out of updates.`,
  };
}

/** Formats the reminder variables + preview. */
export function buildReminderMessage(a: {
  clientName: string;
  serviceName: string;
  whenText: string;
  locationName: string;
}) {
  return {
    variables: { "1": a.clientName, "2": a.serviceName, "3": a.whenText, "4": a.locationName },
    preview:
      `Hi ${a.clientName}, a reminder about your upcoming appointment.\n\n` +
      `Service: ${a.serviceName}\nWhen: ${a.whenText}\nWhere: ${a.locationName}\n\n` +
      `Reply STOP to opt out of updates.`,
  };
}
