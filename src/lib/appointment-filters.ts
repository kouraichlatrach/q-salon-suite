import { addDays, addMonths, format, isValid, parse, startOfDay, startOfMonth, startOfWeek } from "date-fns";
import { z } from "zod";
import { fallback } from "@tanstack/zod-adapter";

/**
 * URL-backed filter state for /app/appointments.
 *
 * Everything lives in the query string rather than component state so a
 * filtered view is shareable, bookmarkable and survives a refresh. Multi-selects
 * serialise as comma-separated ids — TanStack Router would happily JSON-encode a
 * real array, but the resulting URL is unreadable and unhand-editable, and this
 * is a URL staff will paste to each other.
 *
 * NOTE ON `loc`: it is in the URL for the Owner's multi-location switch only.
 * The route re-derives the effective location from the signed-in role and
 * ignores this value for anyone else — see resolveLocationId. RLS is the real
 * boundary; this is the second lock, not the first.
 */

export const DATE_FMT = "yyyy-MM-dd";

/**
 * `last_month` exists for Reports only — Appointments has no use for it and
 * doesn't offer it. The preset list each screen shows is passed into
 * DateRangeControl, so adding one here does not add it everywhere.
 */
export type RangePreset = "day" | "week" | "month" | "last_month" | "custom";
export const APPT_STATUSES = ["scheduled", "completed", "cancelled", "no_show"] as const;
export type ApptStatusValue = (typeof APPT_STATUSES)[number];

export const STATUS_LABELS: Record<ApptStatusValue, string> = {
  scheduled: "Scheduled",
  completed: "Completed",
  cancelled: "Cancelled",
  no_show: "No-show",
};

/** Comma-separated ids in the URL, string[] in React. Empty string → []. */
const csvList = fallback(z.string(), "").default("");

export const appointmentSearchSchema = z.object({
  preset: fallback(z.enum(["day", "week", "month", "last_month", "custom"]), "day").default("day"),
  /** Anchor date for the day/week/month presets. */
  date: fallback(z.string(), "").default(""),
  /** Custom range bounds, inclusive of both ends. Only read when preset=custom. */
  from: fallback(z.string(), "").default(""),
  to: fallback(z.string(), "").default(""),
  view: fallback(z.enum(["calendar", "list"]), "calendar").default("calendar"),
  staff: csvList,
  service: csvList,
  status: csvList,
  /** Free-text client name/phone search. */
  q: fallback(z.string(), "").default(""),
  loc: fallback(z.string(), "").default(""),
});

export type AppointmentSearch = z.infer<typeof appointmentSearchSchema>;

/**
 * The values that mean "not set". Fed to the route's `stripSearchParams`
 * middleware so a link only carries the filters actually applied.
 */
export const APPOINTMENT_SEARCH_DEFAULTS = {
  preset: "day",
  date: "",
  from: "",
  to: "",
  view: "calendar",
  staff: "",
  service: "",
  status: "",
  q: "",
  loc: "",
} satisfies AppointmentSearch;

export function parseList(v: string): string[] {
  return v ? v.split(",").filter(Boolean) : [];
}

export function toList(v: string[]): string {
  return v.join(",");
}

/** A `yyyy-MM-dd` string back to a local Date, or null when absent/garbage. */
export function parseDateParam(v: string): Date | null {
  if (!v) return null;
  const d = parse(v, DATE_FMT, new Date());
  return isValid(d) ? startOfDay(d) : null;
}

export function formatDateParam(d: Date): string {
  return format(d, DATE_FMT);
}

/**
 * The half-open [start, end) window the query actually runs against.
 *
 * `weekStartsOn: 0` is pinned explicitly — an unpinned Monday default would
 * silently misreport every week-scoped view (design.md · Place).
 */
export function resolveRange(search: AppointmentSearch): { start: Date; end: Date } {
  const anchor = parseDateParam(search.date) ?? startOfDay(new Date());

  switch (search.preset) {
    case "week": {
      const start = startOfWeek(anchor, { weekStartsOn: 0 });
      return { start, end: addDays(start, 7) };
    }
    case "month": {
      const start = startOfMonth(anchor);
      return { start, end: addMonths(start, 1) };
    }
    case "last_month": {
      const start = startOfMonth(addMonths(anchor, -1));
      return { start, end: addMonths(start, 1) };
    }
    case "custom": {
      const from = parseDateParam(search.from) ?? anchor;
      const rawTo = parseDateParam(search.to) ?? from;
      // A backwards range is a typo, not an intent to show nothing. Swapping is
      // kinder than rendering a confidently empty calendar.
      const [lo, hi] = rawTo < from ? [rawTo, from] : [from, rawTo];
      return { start: lo, end: addDays(hi, 1) }; // `to` is inclusive
    }
    case "day":
    default:
      return { start: anchor, end: addDays(anchor, 1) };
  }
}

/**
 * View mode and date range are independent controls.
 *
 * This used to force `list` for month/custom ranges on the grounds that the
 * calendar grid could only draw a single day or a fixed week. That solved the
 * rendering limit by overriding the user, and left the Calendar toggle
 * unselectable with no explanation. The grid now spans whatever range is
 * selected, so the override is gone: whichever view the user picked is the view
 * they get, at every preset.
 */

/**
 * Which location a Reports session may read.
 *
 * Differs from `resolveLocationId` in two ways, both deliberate:
 *
 * - Reports lets an Owner see **all** locations at once (`null` = no location
 *   filter), which Appointments cannot do — a calendar needs one grid.
 * - It **fails closed**. The previous implementation returned the Manager's
 *   `locationId` straight through, so a Manager whose `user_roles.location_id`
 *   was NULL resolved to `null` — which downstream means "no location filter",
 *   i.e. brand-wide revenue. A missing location must deny, never widen, so that
 *   case returns the `DENY` sentinel and the caller renders nothing.
 */
export const REPORT_SCOPE_DENY = "__deny__" as const;

export function resolveReportLocationId(
  role: string | null,
  tenantLocationId: string | null,
  urlLoc: string,
): string | null | typeof REPORT_SCOPE_DENY {
  if (role === "owner") return urlLoc || null; // null = all locations, intentional
  if (!tenantLocationId) return REPORT_SCOPE_DENY;
  return tenantLocationId;
}

/**
 * Which location this session may actually read.
 *
 * Only an Owner can switch locations, so only an Owner's `loc` param is
 * honoured. For every other role the tenant's own location wins and the URL
 * value is discarded — a Manager hand-editing `?loc=` gets their own location
 * back, not an empty grid that looks like "no appointments here".
 */
export function resolveLocationId(
  role: string | null,
  tenantLocationId: string | null,
  search: AppointmentSearch,
  fallbackLocationId: string | null,
): string | null {
  if (role === "owner") return search.loc || tenantLocationId || fallbackLocationId;
  return tenantLocationId ?? null;
}

/**
 * Whether the window in force is genuinely the current day/week/month rather
 * than one the arrows have wandered to.
 *
 * Drives the pressed state on the preset buttons: leaving "Today" lit while the
 * grid shows a date three days out makes the control assert something false.
 * Custom is always "current" — it has no notion of drift.
 */
export function isCurrentPeriod(search: AppointmentSearch): boolean {
  if (search.preset === "custom") return true;
  const chosen = resolveRange(search).start.getTime();
  const now = resolveRange({ ...search, date: "" }).start.getTime();
  return chosen === now;
}

export function activeFilterCount(search: AppointmentSearch): number {
  return (
    parseList(search.staff).length +
    parseList(search.service).length +
    parseList(search.status).length +
    (search.q.trim() ? 1 : 0)
  );
}
