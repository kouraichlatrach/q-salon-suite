import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { z } from "zod";

import {
  adminRpc,
  buildManageUrl,
  deliverManageLink,
  deliverOtp,
  generateOtpCode,
  normalizePhone,
} from "./booking.server";

export type PublicBrand = {
  id: string;
  name: string;
  slug: string;
  currency: string;
  min_notice_hours: number;
  max_advance_days: number;
  sms_sender: string | null;
};

export type PublicLocation = {
  id: string;
  name: string;
  address: string | null;
  phone: string | null;
  timezone: string;
};

export type PublicService = {
  id: string;
  name: string;
  description: string | null;
  category: string | null;
  duration_minutes: number;
  price: number;
  currency: string;
  /** Deposit config, so the client sees it before committing — not at checkout. */
  deposit_required: boolean;
  deposit_mandatory: boolean;
  /** When true, only clients with no completed visit pay it — phrase as "may". */
  deposit_new_clients_only: boolean;
  deposit_percentage: number | null;
  /** Server-computed; never re-derive this in the UI. */
  deposit_amount: number | null;
};

export type PublicStaff = { user_id: string; full_name: string };

export type PublicSlot = {
  starts_at: string;
  ends_at: string;
  staff_user_id: string;
};

export type PublicAppointment = {
  appointment_id: string;
  brand_id: string;
  brand_name: string;
  brand_slug: string;
  location_id: string;
  location_name: string;
  location_address: string | null;
  service_id: string | null;
  service_name: string | null;
  duration_minutes: number | null;
  staff_user_id: string;
  staff_name: string;
  client_name: string;
  phone: string | null;
  starts_at: string;
  ends_at: string;
  status: string;
  price: number | null;
  currency: string;
  deposit_status: "pending" | "paid" | "refunded" | "forfeited" | "expired" | null;
  deposit_amount: number | null;
  deposit_paid_amount: number | null;
  /** Price minus any deposit still credited to the client. Server-computed. */
  balance_due: number | null;
};

/* ------------------------------------------------------------------ */
/* Catalogue reads                                                     */
/* ------------------------------------------------------------------ */

export const getBookingContext = createServerFn({ method: "GET" })
  .inputValidator((d: { slug: string }) => z.object({ slug: z.string() }).parse(d))
  .handler(async ({ data }) => {
    const brands = await adminRpc<PublicBrand[]>("public_get_brand_by_slug", {
      _slug: data.slug,
    });
    const brand = brands?.[0] ?? null;
    if (!brand) return { brand: null, locations: [] as PublicLocation[] };
    const locations = await adminRpc<PublicLocation[]>("public_list_locations", {
      _brand_id: brand.id,
    });
    return { brand, locations: locations ?? [] };
  });

export const getBookingServices = createServerFn({ method: "GET" })
  .inputValidator((d: { brandId: string; locationId: string }) =>
    z.object({ brandId: z.string().uuid(), locationId: z.string().uuid() }).parse(d),
  )
  .handler(async ({ data }) =>
    (await adminRpc<PublicService[]>("public_list_services", {
      _brand_id: data.brandId,
      _location_id: data.locationId,
    })) ?? [],
  );

export const getBookingStaff = createServerFn({ method: "GET" })
  .inputValidator((d: { brandId: string; locationId: string; serviceId: string }) =>
    z
      .object({
        brandId: z.string().uuid(),
        locationId: z.string().uuid(),
        serviceId: z.string().uuid(),
      })
      .parse(d),
  )
  .handler(async ({ data }) =>
    (await adminRpc<PublicStaff[]>("public_list_staff_for_service", {
      _brand_id: data.brandId,
      _location_id: data.locationId,
      _service_id: data.serviceId,
    })) ?? [],
  );

export const getBookingSlots = createServerFn({ method: "GET" })
  .inputValidator(
    (d: {
      brandId: string;
      locationId: string;
      serviceId: string;
      staffUserId?: string | null;
      dateFrom: string;
      dateTo: string;
    }) =>
      z
        .object({
          brandId: z.string().uuid(),
          locationId: z.string().uuid(),
          serviceId: z.string().uuid(),
          staffUserId: z.string().uuid().nullish(),
          dateFrom: z.string(),
          dateTo: z.string(),
        })
        .parse(d),
  )
  .handler(async ({ data }) =>
    (await adminRpc<PublicSlot[]>("public_compute_slots", {
      _brand_id: data.brandId,
      _location_id: data.locationId,
      _service_id: data.serviceId,
      _staff_user_id: data.staffUserId ?? null,
      _date_from: data.dateFrom,
      _date_to: data.dateTo,
    })) ?? [],
  );

/* ------------------------------------------------------------------ */
/* Phone verification                                                  */
/* ------------------------------------------------------------------ */

export const requestBookingOtp = createServerFn({ method: "POST" })
  .inputValidator((d: { brandId: string; phone: string }) =>
    z.object({ brandId: z.string().uuid(), phone: z.string().min(6).max(24) }).parse(d),
  )
  .handler(async ({ data }) => {
    const phone = normalizePhone(data.phone);
    if (!phone) return { ok: false as const, error: "invalid_phone" };

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: brandRow } = await supabaseAdmin
      .from("brands")
      .select("name, sms_sender")
      .eq("id", data.brandId)
      .maybeSingle();
    if (!brandRow) return { ok: false as const, error: "unknown_brand" };

    const code = generateOtpCode();
    try {
      await adminRpc("public_create_otp", {
        _brand_id: data.brandId,
        _phone: phone,
        _code: code,
        _ttl_minutes: 10,
      });
    } catch (err) {
      if (String(err).includes("rate_limited")) {
        return { ok: false as const, error: "rate_limited" };
      }
      throw err;
    }

    const sent = await deliverOtp({
      phone,
      code,
      brandName: brandRow.name,
      smsSender: (brandRow as { sms_sender?: string | null }).sms_sender ?? null,
    });

    return {
      ok: true as const,
      phone,
      // Only ever populated when no SMS provider is linked, so the flow stays testable.
      devCode: sent.delivered ? null : code,
      smsConfigured: sent.delivered,
    };
  });

/* ------------------------------------------------------------------ */
/* Booking                                                             */
/* ------------------------------------------------------------------ */

export const confirmBooking = createServerFn({ method: "POST" })
  .inputValidator(
    (d: {
      brandId: string;
      locationId: string;
      serviceId: string;
      staffUserId?: string | null;
      startsAt: string;
      name: string;
      phone: string;
      code: string;
      notes?: string | null;
      depositSkipped?: boolean;
      brandSlug: string;
    }) =>
      z
        .object({
          brandId: z.string().uuid(),
          locationId: z.string().uuid(),
          serviceId: z.string().uuid(),
          staffUserId: z.string().uuid().nullish(),
          startsAt: z.string(),
          name: z.string().trim().min(1).max(120),
          phone: z.string().min(6).max(24),
          code: z.string().trim().min(4).max(8),
          notes: z.string().max(500).nullish(),
          // Client declined an *optional* deposit. Rejected server-side if the
          // service's deposit is mandatory.
          depositSkipped: z.boolean().optional(),
          // Needed to build the post-payment confirmation URL.
          brandSlug: z.string().min(1).max(200),
        })
        .parse(d),
  )
  .handler(async ({ data }) => {
    const phone = normalizePhone(data.phone);
    if (!phone) return { ok: false as const, error: "invalid_phone" };

    const verified = await adminRpc<boolean>("public_verify_otp", {
      _brand_id: data.brandId,
      _phone: phone,
      _code: data.code,
    });
    if (!verified) return { ok: false as const, error: "bad_code" };

    const rows = await adminRpc<
      Array<{
        appointment_id: string | null;
        token: string | null;
        error: string | null;
        deposit_required: boolean;
        deposit_amount: number | null;
        hold_expires_at: string | null;
      }>
    >("public_book_appointment", {
      _brand_id: data.brandId,
      _location_id: data.locationId,
      _service_id: data.serviceId,
      _staff_user_id: data.staffUserId ?? null,
      _starts_at: data.startsAt,
      _client_name: data.name,
      _phone: phone,
      _notes: data.notes ?? null,
      _deposit_skipped: data.depositSkipped ?? false,
    });

    const row = rows?.[0];
    if (!row || row.error) {
      return { ok: false as const, error: row?.error ?? "booking_failed" };
    }

    const token = row.token!;
    const origin = new URL(getRequest().url).origin;
    const manageUrl = buildManageUrl(origin, token);

    // Deposit required: the slot is already held (pending) at the DB level, so
    // the client can be sent to checkout without risk of losing it mid-payment.
    // Payment is only ever confirmed later, by the signed webhook.
    if (row.deposit_required && row.deposit_amount) {
      const { openDepositCharge } = await import("./payments/deposits.server");
      // Return to a confirmation page, not the manage page: the client needs to
      // be told the payment succeeded. That page reads payment state from the
      // database, so the redirect itself still proves nothing.
      const confirmUrl = `${origin}/book/${data.brandSlug}/confirmed?token=${encodeURIComponent(token)}`;
      const charge = await openDepositCharge({
        brandId: data.brandId,
        appointmentId: row.appointment_id!,
        amount: Number(row.deposit_amount),
        currency: "QAR",
        description: "Booking deposit",
        returnUrl: confirmUrl,
        attempt: 1,
      });

      if (!charge.ok) {
        return { ok: false as const, error: "deposit_charge_failed" };
      }

      return {
        ok: true as const,
        appointmentId: row.appointment_id!,
        token,
        manageUrl,
        smsSent: false,
        depositRequired: true as const,
        depositAmount: Number(row.deposit_amount),
        checkoutUrl: charge.checkoutUrl,
        holdExpiresAt: row.hold_expires_at,
      };
    }

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: brandRow } = await supabaseAdmin
      .from("brands")
      .select("name, sms_sender")
      .eq("id", data.brandId)
      .maybeSingle();

    const when = new Date(data.startsAt).toUTCString();
    const sent = await deliverManageLink({
      phone,
      brandName: brandRow?.name ?? "your salon",
      when,
      manageUrl,
      smsSender: (brandRow as { sms_sender?: string | null } | null)?.sms_sender ?? null,
    });

    return {
      ok: true as const,
      appointmentId: row.appointment_id!,
      token,
      manageUrl,
      smsSent: sent.delivered,
      depositRequired: false as const,
      depositAmount: null,
      checkoutUrl: null,
      holdExpiresAt: null,
    };
  });

/* ------------------------------------------------------------------ */
/* Manage by token                                                     */
/* ------------------------------------------------------------------ */

export const getAppointmentByToken = createServerFn({ method: "GET" })
  .inputValidator((d: { token: string }) => z.object({ token: z.string().min(8) }).parse(d))
  .handler(async ({ data }) => {
    const rows = await adminRpc<PublicAppointment[]>("public_get_appointment_by_token", {
      _token: data.token,
    });
    return rows?.[0] ?? null;
  });

export const cancelByToken = createServerFn({ method: "POST" })
  .inputValidator((d: { token: string }) => z.object({ token: z.string().min(8) }).parse(d))
  .handler(async ({ data }) => {
    const rows = await adminRpc<
      Array<import("./payments/deposits.server").CancellationOutcome>
    >("public_cancel_by_token", { _token: data.token });
    const row = rows?.[0];
    if (!row?.ok) return { ok: false as const, outcome: row?.outcome ?? "not_cancellable" };

    // Item 6: refunds are automatic on a qualifying cancellation — no approval
    // step. The DB has already decided whether one is owed.
    let refunded = false;
    let refundError: string | undefined;
    if (row.refund_due) {
      const { executeRefundIfDue } = await import("./payments/deposits.server");
      const res = await executeRefundIfDue(row);
      refunded = res.refunded;
      refundError = res.error;
    }

    return {
      ok: true as const,
      outcome: row.outcome,
      refunded,
      refundAmount: row.refund_amount,
      refundError,
    };
  });

export const rescheduleByToken = createServerFn({ method: "POST" })
  .inputValidator((d: { token: string; startsAt: string; staffUserId?: string | null }) =>
    z
      .object({
        token: z.string().min(8),
        startsAt: z.string(),
        staffUserId: z.string().uuid().nullish(),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const result = await adminRpc<string>("public_reschedule_by_token", {
      _token: data.token,
      _new_starts_at: data.startsAt,
      _new_staff_user_id: data.staffUserId ?? null,
    });
    return { result };
  });

/* ------------------------------------------------------------------ */
/* Lookup by phone                                                     */
/* ------------------------------------------------------------------ */

export const lookupBookingsByPhone = createServerFn({ method: "POST" })
  .inputValidator((d: { brandId: string; phone: string; code: string }) =>
    z
      .object({
        brandId: z.string().uuid(),
        phone: z.string().min(6).max(24),
        code: z.string().trim().min(4).max(8),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const phone = normalizePhone(data.phone);
    if (!phone) return { ok: false as const, error: "invalid_phone" };

    const verified = await adminRpc<boolean>("public_verify_otp", {
      _brand_id: data.brandId,
      _phone: phone,
      _code: data.code,
    });
    if (!verified) return { ok: false as const, error: "bad_code" };

    const rows = await adminRpc<
      Array<{
        appointment_id: string;
        token: string | null;
        starts_at: string;
        ends_at: string;
        service_name: string | null;
        location_name: string;
        staff_name: string;
        status: string;
      }>
    >("public_list_appointments_by_phone", { _brand_id: data.brandId, _phone: phone });

    return { ok: true as const, appointments: rows ?? [] };
  });
