import {
  revenueBreakdown, averageTicket, reliabilityBreakdown, volumeSeries, revenueSeries, retention, UNATTRIBUTED_KEY,
} from "./report-stats";
import type { ApptRow, IncomeRow } from "./report-stats";

const A = (id: string, o: Partial<ApptRow>): ApptRow => ({
  id, client_id: "c1", staff_user_id: "s1", service_id: "sv1",
  status: "completed", starts_at: "2026-08-03T10:00:00+03:00", location_id: "L1", ...o,
});
const I = (amount: number, o: Partial<IncomeRow>): IncomeRow => ({
  amount, currency: "QAR", collected_at: "2026-08-03T10:00:00+03:00", appointment_id: "a1", location_id: "L1", ...o,
});

let fails = 0;
function eq(label: string, got: unknown, want: unknown) {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  const ok = g === w;
  if (!ok) fails++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${ok ? "" : `\n        got ${g}\n        want ${w}`}`);
}

// ---- fixture: 4 appointments, 2 staff, 2 services; 5 income rows incl. 1 gift card
const appts: ApptRow[] = [
  A("a1", { staff_user_id: "s1", service_id: "sv1", status: "completed" }),
  A("a2", { staff_user_id: "s1", service_id: "sv2", status: "no_show", client_id: "c2" }),
  A("a3", { staff_user_id: "s2", service_id: "sv1", status: "cancelled", client_id: "c3" }),
  A("a4", { staff_user_id: "s2", service_id: "sv1", status: "completed", client_id: "c4", starts_at: "2026-08-10T10:00:00+03:00" }),
  A("a5", { staff_user_id: "s2", service_id: "sv1", status: "scheduled", client_id: "c5", starts_at: "2026-08-20T10:00:00+03:00" }),
];
const apptById = new Map(appts.map((a) => [a.id, a]));
const income: IncomeRow[] = [
  I(100, { appointment_id: "a1" }),
  I(50,  { appointment_id: "a1" }),           // split payment, same visit
  I(200, { appointment_id: "a4", collected_at: "2026-08-10T10:00:00+03:00" }),
  I(300, { appointment_id: null }),            // gift card sale
  I(25,  { appointment_id: "a-not-visible" }), // income for an appt we can't see
];
const svcName = (id: string) => ({ sv1: "Blowout", sv2: "Colour" })[id] ?? id;
const staffName = (id: string) => ({ s1: "Amal", s2: "Noor" })[id] ?? id;

// ---- revenue by service: sv1 = 100+50+200 = 350, sv2 = 0, unattributed = 300+25 = 325
const byService = revenueBreakdown(income, apptById, "service", svcName);
eq("byService total", byService.total, 675);
eq("byService rows", byService.rows.map((r) => [r.name, r.amount]), [["Blowout", 350], ["Not tied to an appointment", 325]]);
eq("unattributed sorted last", byService.rows[byService.rows.length - 1].key, UNATTRIBUTED_KEY);

// ---- revenue by staff: s1 = 150, s2 = 200, unattributed = 325 -> SAME total
const byStaff = revenueBreakdown(income, apptById, "staff", staffName);
eq("byStaff total equals byService total", byStaff.total, byService.total);
eq("byStaff rows", byStaff.rows.map((r) => [r.name, r.amount]), [["Noor", 200], ["Amal", 150], ["Not tied to an appointment", 325]]);
eq("shares sum to 1", Math.round(byStaff.rows.reduce((s, r) => s + r.share, 0) * 1e6) / 1e6, 1);

// ---- average ticket: attributed 350 over 2 distinct visits (a1, a4) = 175
eq("avgTicket", averageTicket(income, apptById), { value: 175, visits: 2 });

// ---- reliability by staff
// s1: completed 1, noShow 1 -> concluded 2, booked 2, noShowRate .5, cancelRate 0
// s2: completed 1, cancelled 1, scheduled 1 -> concluded 1, booked 3, noShowRate 0, cancelRate 1/3
const rel = reliabilityBreakdown(appts, "staff", staffName);
const s1 = rel.find((r) => r.key === "s1")!, s2 = rel.find((r) => r.key === "s2")!;
eq("s1 concluded/booked", [s1.concluded, s1.booked], [2, 2]);
eq("s1 noShowRate", s1.noShowRate, 0.5);
eq("s2 excludes scheduled from concluded", s2.concluded, 1);
eq("s2 cancelRate counts scheduled in booked", Math.round(s2.cancelRate * 1000) / 1000, 0.333);
eq("both flagged unreliable (n<5)", [s1.reliable, s2.reliable], [false, false]);

// ---- volume: Aug 1-31 -> 31 days, so day buckets
const start = new Date(2026, 7, 1), end = new Date(2026, 8, 1);
const vol = volumeSeries(appts, start, end);
eq("bucket = day for 31d", vol.bucket, "day");
eq("day bucket count", vol.points.length, 31);
eq("Aug 3 total", vol.points.find((p) => p.iso === "2026-08-03")!.total, 3);
eq("Aug 10 total", vol.points.find((p) => p.iso === "2026-08-10")!.total, 1);
eq("volume total = all appts", vol.points.reduce((s, p) => s + p.total, 0), 5);

// ---- week bucketing must start Sunday
const wide = volumeSeries(appts, new Date(2026, 6, 1), new Date(2026, 8, 1));
eq("bucket = week for 62d", wide.bucket, "week");
eq("first week bucket is a Sunday", new Date(wide.points[0].iso + "T00:00:00").getDay(), 0);

// ---- revenue series aligns to volume x-axis
const revSeries = revenueSeries(income, vol.points, "day");
eq("revenue series length matches", revSeries.length, vol.points.length);
eq("Aug 3 revenue", revSeries[2].revenue, 100 + 50 + 300 + 25);
eq("revenue series sums to total", revSeries.reduce((s, p) => s + p.revenue, 0), 675);

// ---- retention: clients c1,c2,c4,c5 attended (c3 cancelled). prior = {c1}
const ret = retention(appts, new Set(["c1"]));
eq("retention", ret, { newClients: 3, returningClients: 1, totalClients: 4, newShare: 0.75 });
eq("cancelled client excluded", ret.totalClients, 4);

console.log(fails === 0 ? "\nALL PASS" : `\n${fails} FAILURES`);
process.exit(fails === 0 ? 0 : 1);
