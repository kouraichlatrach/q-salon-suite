import { useEffect, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { formatMoney } from "@/lib/money";
import { MIN_RATE_SAMPLE, type BreakdownRow, type Reliability } from "@/lib/report-stats";

/**
 * Chart series colours, read from the live CSS custom properties.
 *
 * Recharts writes colours as SVG presentation attributes, and `var()` inside a
 * presentation attribute is not reliably resolved across browsers. That exact
 * indirection is what broke the old Reports charts: every mark was painted
 * `hsl(var(--accent))` against an `oklch()` token, which is not a colour at
 * all — the charts had been rendering with an invalid fill. Resolving the
 * variables to concrete strings here keeps one source of truth in `styles.css`
 * while handing Recharts something it can definitely paint.
 *
 * The light values are the SSR fallback, so a server-rendered first paint is
 * never colourless.
 */
const FALLBACK = ["#b4531f", "#00749b", "#a8801a", "#8a3a6b", "#4a7a2e"] as const;

export function useChartPalette(): string[] {
  const [palette, setPalette] = useState<string[]>([...FALLBACK]);

  useEffect(() => {
    function read() {
      const cs = getComputedStyle(document.documentElement);
      const next = FALLBACK.map((fb, i) => cs.getPropertyValue(`--chart-${i + 1}`).trim() || fb);
      setPalette(next);
    }
    read();
    // The theme toggle swaps a class on <html>; re-read so dark mode gets its
    // own validated steps rather than the light ones.
    const mo = new MutationObserver(read);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["class", "data-theme"] });
    return () => mo.disconnect();
  }, []);

  return palette;
}

const axisStyle = { fontSize: 11, fill: "var(--color-muted-foreground)" } as const;

function ChartFrame({ title, note, children }: { title: string; note?: string; children: React.ReactNode }) {
  return (
    <section className="bg-card p-4 md:p-5">
      <h3 className="font-display text-base font-semibold">{title}</h3>
      {note && <p className="mt-0.5 text-xs text-muted-foreground">{note}</p>}
      <div className="mt-3">{children}</div>
    </section>
  );
}

/**
 * Revenue and volume over the period, as two stacked plots on a shared x-axis.
 *
 * Explicitly NOT a dual-axis chart. Money and appointment counts have unrelated
 * scales, and overlaying them on two y-axes lets the reader infer a correlation
 * that the arbitrary axis alignment invented. Two plots, one x-axis, no implied
 * relationship beyond the shared dates.
 */
export function TrendCharts({
  revenue,
  volume,
  currency,
  bucket,
}: {
  revenue: { label: string; revenue: number }[];
  volume: { label: string; total: number }[];
  currency: string;
  bucket: "day" | "week";
}) {
  const palette = useChartPalette();
  const bucketWord = bucket === "day" ? "day" : "week starting Sunday";
  const empty = revenue.every((r) => r.revenue === 0) && volume.every((v) => v.total === 0);

  if (empty) {
    return (
      <ChartFrame title="Revenue and volume over time">
        <p className="py-8 text-center text-sm text-muted-foreground">
          Nothing recorded in this period yet.
        </p>
      </ChartFrame>
    );
  }

  return (
    <ChartFrame
      title="Revenue and volume over time"
      note={`One point per ${bucketWord}. Revenue is counted when money was collected; volume is counted when the visit was booked to start — so the two lines answer different questions and are deliberately not overlaid on one axis.`}
    >
      <div className="space-y-4">
        <figure>
          <figcaption className="mb-1 text-xs font-medium text-muted-foreground">
            Revenue ({currency})
          </figcaption>
          <div className="h-44 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={revenue} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
                <CartesianGrid stroke="var(--color-border)" vertical={false} />
                <XAxis dataKey="label" tick={axisStyle} tickLine={false} axisLine={false} minTickGap={24} />
                <YAxis tick={axisStyle} tickLine={false} axisLine={false} width={54} />
                <Tooltip
                  contentStyle={{
                    background: "var(--color-card)",
                    border: "1px solid var(--color-border)",
                    borderRadius: 8,
                    fontSize: 12,
                  }}
                  formatter={(v: number) => [formatMoney(v, currency), "Revenue"]}
                />
                <Line
                  type="monotone"
                  dataKey="revenue"
                  stroke={palette[0]}
                  strokeWidth={2}
                  dot={false}
                  activeDot={{ r: 4, strokeWidth: 2, stroke: "var(--color-card)" }}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </figure>

        <figure>
          <figcaption className="mb-1 text-xs font-medium text-muted-foreground">
            Appointments booked
          </figcaption>
          <div className="h-32 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={volume} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
                <CartesianGrid stroke="var(--color-border)" vertical={false} />
                <XAxis dataKey="label" tick={axisStyle} tickLine={false} axisLine={false} minTickGap={24} />
                <YAxis tick={axisStyle} tickLine={false} axisLine={false} width={54} allowDecimals={false} />
                <Tooltip
                  cursor={{ fill: "var(--color-muted)" }}
                  contentStyle={{
                    background: "var(--color-card)",
                    border: "1px solid var(--color-border)",
                    borderRadius: 8,
                    fontSize: 12,
                  }}
                  formatter={(v: number) => [v, "Appointments"]}
                />
                {/* 4px rounded data-end, anchored to the baseline. */}
                <Bar dataKey="total" fill={palette[1]} radius={[4, 4, 0, 0]} maxBarSize={28} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </figure>
      </div>
    </ChartFrame>
  );
}

/**
 * Revenue split by service or staff.
 *
 * Plain HTML bars rather than a charting library: at this size the label, the
 * figure and the bar all need to stay on one row and stay legible at 320px,
 * which is far easier to guarantee without an SVG layout engine in the way.
 * Every row is directly labelled, so no legend is needed and colour is never
 * the only carrier of identity.
 */
export function BreakdownBars({
  title,
  note,
  rows,
  total,
  currency,
  colorIndex,
  emptyText,
}: {
  title: string;
  note?: string;
  rows: BreakdownRow[];
  total: number;
  currency: string;
  colorIndex: number;
  emptyText: string;
}) {
  const palette = useChartPalette();
  const color = palette[colorIndex % palette.length];
  const max = rows.reduce((m, r) => Math.max(m, r.amount), 0);

  return (
    <ChartFrame title={title} note={note}>
      {rows.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">{emptyText}</p>
      ) : (
        <>
          <ul className="space-y-2.5">
            {rows.slice(0, 10).map((r) => (
              <li key={r.key}>
                <div className="flex items-baseline justify-between gap-3">
                  <span className="min-w-0 truncate text-sm" dir="auto">{r.name}</span>
                  <span className="tnum shrink-0 text-sm font-medium [overflow-wrap:normal]">
                    {formatMoney(r.amount, currency)}
                    <span className="ml-1.5 font-normal text-muted-foreground">
                      {(r.share * 100).toFixed(0)}%
                    </span>
                  </span>
                </div>
                <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full"
                    style={{ width: max > 0 ? `${(r.amount / max) * 100}%` : "0%", background: color }}
                  />
                </div>
              </li>
            ))}
          </ul>
          <p className="mt-3 border-t border-border pt-2 text-xs text-muted-foreground">
            Total{" "}
            <span className="tnum font-medium text-foreground [overflow-wrap:normal]">
              {formatMoney(total, currency)}
            </span>
            {rows.length > 10 && ` · showing top 10 of ${rows.length}`}
          </p>
        </>
      )}
    </ChartFrame>
  );
}

/**
 * No-show and cancellation rates.
 *
 * Every rate ships its own denominator, and any row with fewer than
 * MIN_RATE_SAMPLE concluded visits is greyed and labelled rather than shown as
 * a headline percentage. One appointment that no-showed is not a 100% no-show
 * rate — printing it as one beside a person's name is the exact shape of
 * plausible-but-wrong number this screen exists to avoid.
 */
export function ReliabilityTable({
  title,
  rows,
  emptyText,
  entityLabel,
}: {
  title: string;
  rows: Reliability[];
  emptyText: string;
  entityLabel: string;
}) {
  const anyUnreliable = rows.some((r) => !r.reliable);

  return (
    <ChartFrame
      title={title}
      note={`No-show rate counts only visits that concluded — still-scheduled appointments are excluded, because their outcome isn't known yet. Cancellation rate is measured against everything booked.`}
    >
      {rows.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">{emptyText}</p>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs text-muted-foreground">
                  <th scope="col" className="pb-2 font-medium">{entityLabel}</th>
                  <th scope="col" className="pb-2 text-right font-medium">Concluded</th>
                  <th scope="col" className="pb-2 text-right font-medium">No-show</th>
                  <th scope="col" className="pb-2 text-right font-medium">Cancelled</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.key} className="border-b border-border/60 last:border-0">
                    <td className="py-2 pr-2">
                      <span className="block truncate" dir="auto">{r.name}</span>
                    </td>
                    <td className="tnum py-2 text-right text-muted-foreground [overflow-wrap:normal]">
                      {r.concluded}
                    </td>
                    <td className="tnum py-2 text-right [overflow-wrap:normal]">
                      {r.concluded === 0 ? (
                        <span className="text-muted-foreground" title="Nothing has concluded yet">—</span>
                      ) : r.reliable ? (
                        <span
                          className={
                            r.noShowRate >= 0.15
                              ? "font-medium text-red-700"
                              : r.noShowRate >= 0.05
                                ? "font-medium text-amber-700"
                                : "text-muted-foreground"
                          }
                        >
                          {(r.noShowRate * 100).toFixed(1)}%
                        </span>
                      ) : (
                        <span className="text-muted-foreground" title="Too few concluded visits to be meaningful">
                          {r.noShow}/{r.concluded}
                        </span>
                      )}
                    </td>
                    <td className="tnum py-2 text-right text-muted-foreground [overflow-wrap:normal]">
                      {r.booked === 0
                        ? "—"
                        : r.booked >= MIN_RATE_SAMPLE
                          ? `${(r.cancelRate * 100).toFixed(1)}%`
                          : `${r.cancelled}/${r.booked}`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {anyUnreliable && (
            <p className="mt-3 text-xs text-muted-foreground">
              Each column uses its own denominator: no-show is measured against concluded visits,
              cancellation against everything booked. Where that denominator is under{" "}
              {MIN_RATE_SAMPLE} the cell shows raw counts instead of a percentage — a rate drawn
              from one or two visits says more about the sample than the person.
            </p>
          )}
        </>
      )}
    </ChartFrame>
  );
}

/**
 * New vs returning, as a two-part proportion.
 *
 * A two-slice pie would be the reflex here and it is the wrong form — a single
 * stacked bar with both figures written out reads faster and doesn't ask anyone
 * to compare angles.
 */
export function RetentionSplit({
  newClients,
  returningClients,
  totalClients,
  scopeNote,
}: {
  newClients: number;
  returningClients: number;
  totalClients: number;
  scopeNote: string;
}) {
  const palette = useChartPalette();
  const newPct = totalClients > 0 ? (newClients / totalClients) * 100 : 0;

  return (
    <ChartFrame title="New vs returning clients" note={scopeNote}>
      {totalClients === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">
          No clients attended in this period.
        </p>
      ) : (
        <>
          {/* 2px surface gap between the two fills, per mark spec. */}
          <div className="flex h-2.5 w-full gap-0.5 overflow-hidden rounded-full">
            <div style={{ width: `${newPct}%`, background: palette[4] }} />
            <div style={{ width: `${100 - newPct}%`, background: palette[3] }} />
          </div>
          <dl className="mt-3 grid grid-cols-2 gap-3">
            <div>
              <dt className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <span aria-hidden className="h-2 w-2 rounded-full" style={{ background: palette[4] }} />
                First visit here
              </dt>
              <dd className="tnum mt-0.5 text-xl font-semibold [overflow-wrap:normal]">
                {newClients}
                <span className="ml-1.5 text-sm font-normal text-muted-foreground">
                  {newPct.toFixed(0)}%
                </span>
              </dd>
            </div>
            <div>
              <dt className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <span aria-hidden className="h-2 w-2 rounded-full" style={{ background: palette[3] }} />
                Returning
              </dt>
              <dd className="tnum mt-0.5 text-xl font-semibold [overflow-wrap:normal]">
                {returningClients}
                <span className="ml-1.5 text-sm font-normal text-muted-foreground">
                  {(100 - newPct).toFixed(0)}%
                </span>
              </dd>
            </div>
          </dl>
        </>
      )}
    </ChartFrame>
  );
}
