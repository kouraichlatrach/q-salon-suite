import { addDays, addWeeks, differenceInCalendarDays, format, startOfDay, startOfWeek } from "date-fns";

/**
 * Pure aggregation for /app/reports.
 *
 * Deliberately free of Supabase and React so every figure on that screen can be
 * checked against a fixture without a database. The previous implementation did
 * all of this inline inside a `useQuery`, which is why four separate arithmetic
 * bugs survived in it — none of them were reachable by a test.
 *
 * ## The date-basis rule
 *
 * Revenue is counted by `collected_at` (when the money arrived). Appointment
 * volume, no-show and cancellation are counted by `starts_at` (when the visit
 * was meant to happen). These are different populations and must never be
 * divided into each other — the old "average ticket" did exactly that, taking
 * revenue by `collected_at` over a completed-count by `starts_at`, so a visit
 * booked in June and paid in July inflated July's revenue without incrementing
 * July's denominator.
 */

export type ApptRow = {
  id: string;
  client_id: string;
  staff_user_id: string;
  service_id: string | null;
  status: "scheduled" | "completed" | "cancelled" | "no_show";
  starts_at: string;
  location_id: string;
};

export type IncomeRow = {
  amount: number | string;
  currency: string;
  collected_at: string;
  appointment_id: string | null;
  location_id: string;
};

export type BreakdownRow = {
  key: string;
  name: string;
  amount: number;
  /** Share of the period's total revenue, 0–1. */
  share: number;
};

/** Rates computed on fewer than this many concluded visits are noise, not signal. */
export const MIN_RATE_SAMPLE = 5;

export const UNATTRIBUTED_KEY = "__unattributed__";

function num(v: number | string): number {
  const n = typeof v === "string" ? parseFloat(v) : v;
  return Number.isFinite(n) ? n : 0;
}

/**
 * Revenue grouped by whatever the appointment points at (service or staff).
 *
 * Income with no `appointment_id` — package sales and gift-card sales, which
 * this product recognises at the moment of sale — cannot belong to a service or
 * a staff member. It is returned as an explicit `Unattributed` row rather than
 * being silently dropped, so **both** breakdowns sum to the same headline total.
 * The old code bucketed it into by-service but dropped it from by-staff, giving
 * two tables that looked comparable and weren't.
 */
export function revenueBreakdown(
  income: IncomeRow[],
  apptById: Map<string, ApptRow>,
  dimension: "service" | "staff",
  nameFor: (id: string) => string,
  unattributedLabel = "Not tied to an appointment",
): { rows: BreakdownRow[]; total: number } {
  const totals = new Map<string, number>();
  let total = 0;

  for (const r of income) {
    const amount = num(r.amount);
    total += amount;

    const appt = r.appointment_id ? apptById.get(r.appointment_id) : undefined;
    // An income row whose appointment we cannot see is unattributed too —
    // guessing would invent a number.
    const key =
      !appt
        ? UNATTRIBUTED_KEY
        : dimension === "service"
          ? (appt.service_id ?? UNATTRIBUTED_KEY)
          : appt.staff_user_id;

    totals.set(key, (totals.get(key) ?? 0) + amount);
  }

  const rows = Array.from(totals.entries())
    .map(([key, amount]) => ({
      key,
      name: key === UNATTRIBUTED_KEY ? unattributedLabel : nameFor(key),
      amount,
      share: total > 0 ? amount / total : 0,
    }))
    // Unattributed always sits last regardless of size — it is context, not a
    // competitor to the real rows.
    .sort((a, b) => {
      if (a.key === UNATTRIBUTED_KEY) return 1;
      if (b.key === UNATTRIBUTED_KEY) return -1;
      return b.amount - a.amount;
    });

  return { rows, total };
}

/**
 * Average ticket, computed inside a single population.
 *
 * Numerator and denominator both come from income rows that landed in the
 * range: total attributed revenue over the number of *distinct appointments*
 * that produced it. Unattributed income is excluded from both halves — a gift
 * card sale is not a visit and would drag the average toward nonsense.
 */
export function averageTicket(
  income: IncomeRow[],
  apptById: Map<string, ApptRow>,
): { value: number; visits: number } {
  const visits = new Set<string>();
  let attributed = 0;
  for (const r of income) {
    // Must be an appointment we can actually see, not merely a non-null id.
    // An income row pointing at an appointment outside the current filter (or
    // outside what RLS returns) would otherwise count as a visit in the
    // denominator while its revenue is treated as unattributed in the
    // breakdowns — the average would silently sag toward zero.
    if (!r.appointment_id || !apptById.has(r.appointment_id)) continue;
    visits.add(r.appointment_id);
    attributed += num(r.amount);
  }
  return { value: visits.size > 0 ? attributed / visits.size : 0, visits: visits.size };
}

export type Reliability = {
  key: string;
  name: string;
  completed: number;
  noShow: number;
  cancelled: number;
  /** completed + no_show — visits whose outcome is actually known. */
  concluded: number;
  booked: number;
  noShowRate: number;
  cancelRate: number;
  /** False when `concluded` is too small for the rate to mean anything. */
  reliable: boolean;
};

/**
 * No-show and cancellation rates per staff member or per service.
 *
 * Two decisions worth stating, because both change the number materially:
 *
 * 1. **Still-`scheduled` appointments are excluded from the no-show denominator.**
 *    Their outcome is unknown. The old code counted every non-cancelled
 *    appointment, so a month with many future bookings reported a no-show rate
 *    diluted toward zero — reassuring and wrong.
 * 2. **Cancellation is measured against everything booked**, including
 *    scheduled, because a cancellation is already a known outcome.
 *
 * `reliable` is false below MIN_RATE_SAMPLE concluded visits. One appointment
 * that no-showed is not a 100% no-show rate, and rendering it as one next to a
 * staff member's name is the kind of plausible-looking number that does real
 * damage.
 */
export function reliabilityBreakdown(
  appts: ApptRow[],
  dimension: "service" | "staff",
  nameFor: (id: string) => string,
  unattributedLabel = "No service recorded",
): Reliability[] {
  const acc = new Map<string, { completed: number; noShow: number; cancelled: number; scheduled: number }>();

  for (const a of appts) {
    const key = dimension === "staff" ? a.staff_user_id : (a.service_id ?? UNATTRIBUTED_KEY);
    const cur = acc.get(key) ?? { completed: 0, noShow: 0, cancelled: 0, scheduled: 0 };
    if (a.status === "completed") cur.completed += 1;
    else if (a.status === "no_show") cur.noShow += 1;
    else if (a.status === "cancelled") cur.cancelled += 1;
    else cur.scheduled += 1;
    acc.set(key, cur);
  }

  return Array.from(acc.entries())
    .map(([key, c]) => {
      const concluded = c.completed + c.noShow;
      const booked = concluded + c.cancelled + c.scheduled;
      return {
        key,
        name: key === UNATTRIBUTED_KEY ? unattributedLabel : nameFor(key),
        completed: c.completed,
        noShow: c.noShow,
        cancelled: c.cancelled,
        concluded,
        booked,
        noShowRate: concluded > 0 ? c.noShow / concluded : 0,
        cancelRate: booked > 0 ? c.cancelled / booked : 0,
        reliable: concluded >= MIN_RATE_SAMPLE,
      };
    })
    .sort((a, b) => {
      // Unreliable rows sink; among reliable ones the worst rate leads, since
      // that is the row an Owner is looking for.
      if (a.reliable !== b.reliable) return a.reliable ? -1 : 1;
      return b.noShowRate - a.noShowRate || b.concluded - a.concluded;
    });
}

export type VolumePoint = { label: string; iso: string; total: number; completed: number; noShow: number; cancelled: number };

/**
 * Appointment volume bucketed by day, or by week once the range is long enough
 * that per-day bars turn into a picket fence.
 *
 * Week buckets start **Sunday** (`weekStartsOn: 0`). The previous Reports code
 * pinned `weekStartsOn: 1`, which is a Monday week — wrong for Qatar, and worse
 * than leaving it unpinned because it looked deliberate.
 */
export function volumeSeries(appts: ApptRow[], start: Date, end: Date): { points: VolumePoint[]; bucket: "day" | "week" } {
  const span = differenceInCalendarDays(end, start);
  const bucket: "day" | "week" = span > 31 ? "week" : "day";

  const points: VolumePoint[] = [];
  const index = new Map<string, VolumePoint>();

  if (bucket === "day") {
    for (let d = startOfDay(start); d < end; d = addDays(d, 1)) {
      const iso = format(d, "yyyy-MM-dd");
      const p: VolumePoint = { label: format(d, "d MMM"), iso, total: 0, completed: 0, noShow: 0, cancelled: 0 };
      points.push(p);
      index.set(iso, p);
    }
  } else {
    for (let w = startOfWeek(start, { weekStartsOn: 0 }); w < end; w = addWeeks(w, 1)) {
      const iso = format(w, "yyyy-MM-dd");
      const p: VolumePoint = { label: format(w, "d MMM"), iso, total: 0, completed: 0, noShow: 0, cancelled: 0 };
      points.push(p);
      index.set(iso, p);
    }
  }

  for (const a of appts) {
    const at = new Date(a.starts_at);
    const key =
      bucket === "day"
        ? format(startOfDay(at), "yyyy-MM-dd")
        : format(startOfWeek(at, { weekStartsOn: 0 }), "yyyy-MM-dd");
    const p = index.get(key);
    if (!p) continue; // outside the rendered window
    p.total += 1;
    if (a.status === "completed") p.completed += 1;
    else if (a.status === "no_show") p.noShow += 1;
    else if (a.status === "cancelled") p.cancelled += 1;
  }

  return { points, bucket };
}

/** Revenue bucketed onto the same x-axis as `volumeSeries`, so the two plots align. */
export function revenueSeries(income: IncomeRow[], points: VolumePoint[], bucket: "day" | "week"): { label: string; revenue: number }[] {
  const index = new Map(points.map((p) => [p.iso, 0]));
  for (const r of income) {
    const at = new Date(r.collected_at);
    const key =
      bucket === "day"
        ? format(startOfDay(at), "yyyy-MM-dd")
        : format(startOfWeek(at, { weekStartsOn: 0 }), "yyyy-MM-dd");
    if (index.has(key)) index.set(key, index.get(key)! + num(r.amount));
  }
  return points.map((p) => ({ label: p.label, revenue: index.get(p.iso) ?? 0 }));
}

/**
 * New vs returning clients in the period.
 *
 * "New" means this is the client's first visit *within the scope being viewed*.
 * `priorClientIds` must therefore be computed with the same brand/location
 * filter as the range query: for a Manager restricted to one location, asking
 * whether the client had ever visited brand-wide would leak the existence of
 * visits at locations they are not permitted to see. The label on screen says
 * "to this location" whenever a location filter is active, so the figure is
 * never read as a brand-wide claim.
 */
export function retention(
  apptsInRange: ApptRow[],
  priorClientIds: Set<string>,
): { newClients: number; returningClients: number; totalClients: number; newShare: number } {
  const seen = new Set<string>();
  for (const a of apptsInRange) {
    // A cancelled visit is not a visit — counting it would report a client as
    // "returning" on the strength of an appointment nobody attended.
    if (a.status === "cancelled") continue;
    seen.add(a.client_id);
  }
  let newClients = 0;
  let returningClients = 0;
  for (const id of seen) {
    if (priorClientIds.has(id)) returningClients += 1;
    else newClients += 1;
  }
  const totalClients = newClients + returningClients;
  return { newClients, returningClients, totalClients, newShare: totalClients > 0 ? newClients / totalClients : 0 };
}

/**
 * Currencies present in the period. The old code took `income[0].currency` and
 * labelled every total with it, which would mislabel the whole screen if a
 * second currency ever appeared rather than failing visibly.
 */
export function currenciesPresent(income: IncomeRow[]): string[] {
  return Array.from(new Set(income.map((r) => r.currency).filter(Boolean)));
}
