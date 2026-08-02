/**
 * Appointment reminder sweep (Section 10).
 *
 * Invoked on a schedule rather than by per-appointment timers. Each run asks the
 * database, live, which appointments are currently due a reminder — so a
 * booking cancelled or moved since the last run simply stops matching. That is
 * the entire race-safety story; no locks or reconciliation are involved.
 *
 * `reminded_at` is set only *after* a successful send. A provider failure
 * therefore leaves the row eligible and it retries next sweep, rather than
 * being silently marked done and never sent.
 */

import { adminRpc } from "../booking.server";
import { buildReminderMessage, dispatchAppointmentMessage } from "./messaging.server";

export { JOBS_REMINDER_PATH } from "./jobs-path";

type DueRow = {
  appointment_id: string;
  brand_id: string;
  client_id: string;
  client_name: string;
  phone: string;
  service_name: string;
  location_name: string;
  starts_at: string;
  timezone: string;
};

export type ReminderSweepSummary = {
  considered: number;
  sent: number;
  failed: number;
  skipped: number;
};

function formatWhen(iso: string, timeZone: string): string {
  try {
    return new Intl.DateTimeFormat("en-GB", {
      weekday: "long",
      day: "numeric",
      month: "long",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
      timeZone,
    }).format(new Date(iso));
  } catch {
    // A bad IANA zone must not stop the reminder going out.
    return new Date(iso).toUTCString();
  }
}

export async function runReminderSweep(limit = 50): Promise<ReminderSweepSummary> {
  const due = (await adminRpc<DueRow[]>("whatsapp_due_reminders", { _limit: limit })) ?? [];
  const summary: ReminderSweepSummary = {
    considered: due.length,
    sent: 0,
    failed: 0,
    skipped: 0,
  };

  for (const row of due) {
    const { variables, preview } = buildReminderMessage({
      clientName: row.client_name,
      serviceName: row.service_name,
      whenText: formatWhen(row.starts_at, row.timezone),
      locationName: row.location_name,
    });

    const result = await dispatchAppointmentMessage({
      brandId: row.brand_id,
      appointmentId: row.appointment_id,
      clientId: row.client_id,
      kind: "appointment_reminder",
      toPhone: row.phone,
      variables,
      preview,
    });

    if (result.sent) {
      // Only now is it safe to mark reminded.
      await adminRpc("whatsapp_mark_reminded", { _appointment_id: row.appointment_id });
      summary.sent += 1;
    } else if (result.reason.includes("not configured") || result.reason.includes("disabled")) {
      summary.skipped += 1;
    } else {
      summary.failed += 1;
    }
  }

  return summary;
}

/**
 * HTTP entry point for the scheduler.
 *
 * Guarded by a shared secret because it triggers outbound messaging: an open
 * endpoint would let anyone spam every client due a reminder, and burn through
 * the messaging quota.
 */
export async function handleReminderJobRequest(request: Request): Promise<Response> {
  const secret = (process.env.JOBS_SECRET || "").trim();
  const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    });

  if (!secret) return json(503, { error: "JOBS_SECRET not configured" });

  const provided =
    request.headers.get("x-jobs-secret") ??
    new URL(request.url).searchParams.get("secret") ??
    "";

  if (provided !== secret) return json(403, { error: "forbidden" });
  if (request.method !== "POST") return json(405, { error: "method_not_allowed" });

  try {
    const summary = await runReminderSweep();
    return json(200, { ok: true, ...summary });
  } catch (err) {
    console.error("[whatsapp] reminder sweep failed", err);
    return json(500, { error: "sweep_failed" });
  }
}
