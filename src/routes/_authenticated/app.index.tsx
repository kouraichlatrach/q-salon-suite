import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
  startOfDay,
  endOfDay,
  startOfWeek,
  endOfWeek,
  format,
  parseISO,
} from "date-fns";
import { useEffect, useState } from "react";
import { ArrowRight, X } from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/hooks/use-tenant";
import { AppShell } from "@/components/app-shell";
import { Skeleton } from "@/components/ui/skeleton";

export const Route = createFileRoute("/_authenticated/app/")({
  head: () => ({
    meta: [{ title: "Dashboard — Q-Salon Suite" }, { name: "robots", content: "noindex" }],
  }),
  component: DashboardPage,
});

function DashboardPage() {
  return (
    <AppShell>
      <Dashboard />
    </AppShell>
  );
}

/**
 * The Qatari working week runs Sunday–Thursday.
 *
 * date-fns defaults to Sunday, but pinning it makes the intent explicit and
 * survives a locale default changing underneath us. An unpinned Monday start
 * would silently misreport the weekly figure for every salon on the platform
 * — wrong on Sunday, and wrong in a way nobody would spot until month-end.
 */
const WEEK_STARTS_ON = 0 as const;

/**
 * Amount only — the currency code lives in the stat's label.
 *
 * Rendering "QAR 1,292" at display size broke across two lines in a two-column
 * cell at 768px, splitting the number itself ("QAR 1,29" / "2"). Repeating the
 * code on every figure is also poor form in a money column: name the unit once
 * in the header and let the numerals line up.
 */
const money = (amount: number) =>
  new Intl.NumberFormat("en-QA", { maximumFractionDigits: 0 }).format(amount);

const BANNER_KEY = "qss.whatsNew.dismissed.v1";

function Dashboard() {
  const tenant = useTenant();
  const brandId = tenant.data?.brandId ?? null;
  const locationId = tenant.data?.locationId ?? null;
  const userId = tenant.data?.userId ?? null;
  const role = tenant.data?.primaryRole ?? null;

  // Owners see the whole brand; a Manager or Receptionist sees their own
  // branch; a technician sees only their own day. This is a *presentation*
  // scope — RLS is the actual guard, and these queries are written so that a
  // policy change tightens them rather than contradicting them.
  const isOwner = role === "owner";
  const isStaff = role === "staff";
  const seesMoney = role === "owner" || role === "manager";
  const scopedLocation = !isOwner && locationId ? locationId : null;

  const kpis = useQuery({
    enabled: !!brandId && !!role,
    queryKey: ["dashboard-kpis", brandId, role, scopedLocation, userId],
    queryFn: async () => {
      const now = new Date();
      const dayStart = startOfDay(now).toISOString();
      const dayEnd = endOfDay(now).toISOString();
      const weekStart = startOfWeek(now, { weekStartsOn: WEEK_STARTS_ON }).toISOString();
      const weekEnd = endOfWeek(now, { weekStartsOn: WEEK_STARTS_ON }).toISOString();

      let apptQ = supabase
        .from("appointments")
        .select("id", { count: "exact", head: true })
        .eq("brand_id", brandId!)
        .neq("status", "cancelled")
        .gte("starts_at", dayStart)
        .lte("starts_at", dayEnd);
      if (scopedLocation) apptQ = apptQ.eq("location_id", scopedLocation);
      if (isStaff && userId) apptQ = apptQ.eq("staff_user_id", userId);
      const apptRes = await apptQ;

      let revenue = 0;
      let currency = "QAR";
      let activeClients = 0;
      let lowStock = 0;

      if (seesMoney) {
        let incomeQ = supabase
          .from("income_records")
          .select("amount, currency")
          .eq("brand_id", brandId!)
          .gte("collected_at", weekStart)
          .lte("collected_at", weekEnd);
        if (scopedLocation) incomeQ = incomeQ.eq("location_id", scopedLocation);
        const incomeRes = await incomeQ;
        revenue = (incomeRes.data ?? []).reduce((s, r) => s + Number(r.amount ?? 0), 0);
        currency = (incomeRes.data?.[0]?.currency as string | undefined) ?? "QAR";
      }

      if (!isStaff) {
        // Clients are shared brand-wide by design, so this one is not
        // location-scoped even for a Manager.
        const clientsRes = await supabase
          .from("clients")
          .select("id", { count: "exact", head: true })
          .eq("brand_id", brandId!);
        activeClients = clientsRes.count ?? 0;

        const locIds = scopedLocation
          ? [scopedLocation]
          : ((
              await supabase.from("locations").select("id").eq("brand_id", brandId!)
            ).data ?? []).map((l) => l.id);

        if (locIds.length > 0) {
          const stockRes = await supabase
            .from("location_stock")
            .select("quantity, low_stock_threshold")
            .in("location_id", locIds);
          lowStock = (stockRes.data ?? []).filter(
            (r) => Number(r.quantity) <= Number(r.low_stock_threshold ?? 0),
          ).length;
        }
      }

      return {
        todayAppointments: apptRes.count ?? 0,
        revenue,
        currency,
        activeClients,
        lowStock,
      };
    },
  });

  const upcoming = useQuery({
    enabled: !!brandId && !!role,
    queryKey: ["dashboard-next", brandId, role, scopedLocation, userId],
    queryFn: async () => {
      const now = new Date();
      let q = supabase
        .from("appointments")
        .select("id, starts_at, status, clients(name), services(name)")
        .eq("brand_id", brandId!)
        .neq("status", "cancelled")
        .gte("starts_at", now.toISOString())
        .lte("starts_at", endOfDay(now).toISOString())
        .order("starts_at")
        .limit(5);
      if (scopedLocation) q = q.eq("location_id", scopedLocation);
      if (isStaff && userId) q = q.eq("staff_user_id", userId);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as unknown as {
        id: string;
        starts_at: string;
        clients: { name: string } | null;
        services: { name: string } | null;
      }[];
    },
  });

  const [bannerHidden, setBannerHidden] = useState(true);
  useEffect(() => {
    // Read after mount so SSR and the client agree on first paint.
    setBannerHidden(localStorage.getItem(BANNER_KEY) === "1");
  }, []);
  function dismissBanner() {
    localStorage.setItem(BANNER_KEY, "1");
    setBannerHidden(true);
  }

  const loading = kpis.isLoading;
  const d = kpis.data;
  const firstName = tenant.data?.fullName?.split(" ")[0];

  const stats: { label: string; value: string | null; to: string; note?: string }[] = [
    {
      label: isStaff ? "Your appointments today" : "Appointments today",
      value: loading ? null : String(d?.todayAppointments ?? 0),
      to: "/app/appointments",
    },
    ...(seesMoney
      ? [
          {
            label: `Revenue this week (${d?.currency ?? "QAR"})`,
            value: loading ? null : money(d?.revenue ?? 0),
            to: "/app/reports",
            note: "Sun–Sat",
          },
        ]
      : []),
    ...(!isStaff
      ? [
          {
            label: "Clients on file",
            value: loading ? null : String(d?.activeClients ?? 0),
            to: "/app/clients",
          },
          {
            label: "Low stock items",
            value: loading ? null : String(d?.lowStock ?? 0),
            to: "/app/stock",
          },
        ]
      : []),
  ];

  return (
    <div className="mx-auto max-w-6xl px-5 py-[var(--space-lg)] md:px-10 md:py-[var(--space-xl)]">
      <header>
        <p className="text-sm text-muted-foreground">
          {format(new Date(), "EEEE, d MMMM")}
          {scopedLocation ? " · your branch" : isOwner ? " · all locations" : ""}
        </p>
        <h1 className="mt-1 font-display text-[length:var(--text-display)] font-medium tracking-tight">
          {firstName ? `Morning, ${firstName}` : "Dashboard"}
        </h1>
      </header>

      {/* Stat-Led: the numbers are the page. Hairline-separated cells rather
          than four floating cards — a working dashboard should read as one
          instrument, not a scattering of widgets. */}
      <section
        aria-label="Today at a glance"
        className="mt-[var(--space-lg)] grid gap-px overflow-hidden rounded-[var(--radius)] border border-border bg-border sm:grid-cols-2 lg:grid-cols-4"
      >
        {stats.map((s) => (
          <Link
            key={s.label}
            to={s.to}
            className="group bg-card p-[var(--space-md)] transition-[color,background-color,border-color] duration-[var(--dur-fast)] ease-[var(--ease-out)] hover:bg-secondary focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--color-focus)] md:p-[var(--space-lg)]"
          >
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {s.label}
              </span>
              {s.note && (
                <span className="shrink-0 text-[11px] text-muted-foreground">{s.note}</span>
              )}
            </div>
            {s.value === null ? (
              <Skeleton className="mt-[var(--space-sm)] h-9 w-24" />
            ) : (
              // `overflow-wrap: anywhere` is set globally on display type for
              // gate 51, which is right for headings and wrong for numerals —
              // it will split a figure between digits. Numbers never wrap.
              <div className="tnum mt-[var(--space-xs)] overflow-hidden text-ellipsis whitespace-nowrap font-display text-[length:var(--text-stat)] font-medium leading-none [overflow-wrap:normal]">
                {s.value}
              </div>
            )}
            <div className="mt-[var(--space-sm)] inline-flex items-center gap-1 text-xs text-muted-foreground transition-[color,background-color,border-color] duration-[var(--dur-fast)] ease-[var(--ease-out)] group-hover:text-foreground">
              Open
              <ArrowRight aria-hidden="true" className="h-3 w-3" />
            </div>
          </Link>
        ))}
      </section>

      {kpis.isError && (
        <p className="mt-[var(--space-sm)] text-sm text-destructive">
          Couldn't load today's figures. Refresh, or check your connection.
        </p>
      )}

      <section aria-labelledby="next-heading" className="mt-[var(--space-2xl)]">
        <h2
          id="next-heading"
          className="font-display text-[length:var(--text-display-s)] font-medium"
        >
          Still to come today
        </h2>

        {upcoming.isLoading ? (
          <Skeleton className="mt-[var(--space-md)] h-24 w-full" />
        ) : (upcoming.data?.length ?? 0) === 0 ? (
          <p className="mt-[var(--space-sm)] text-sm text-muted-foreground">
            Nothing left on the book for today.
          </p>
        ) : (
          <ul className="mt-[var(--space-md)] divide-y divide-border overflow-hidden rounded-[var(--radius)] border border-border bg-card">
            {upcoming.data!.map((a) => (
              <li
                key={a.id}
                className="flex items-baseline gap-[var(--space-md)] p-[var(--space-md)]"
              >
                <span className="tnum w-14 shrink-0 text-sm font-medium">
                  {format(parseISO(a.starts_at), "HH:mm")}
                </span>
                <span className="min-w-0 flex-1 truncate text-sm" dir="auto">
                  {a.clients?.name ?? "Client"}
                </span>
                <span className="hidden min-w-0 flex-1 truncate text-sm text-muted-foreground sm:block">
                  {a.services?.name ?? "—"}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {!bannerHidden && (
        <div className="mt-[var(--space-2xl)] flex items-start gap-[var(--space-sm)] rounded-[var(--radius)] border border-dashed border-border p-[var(--space-md)]">
          <p className="min-w-0 flex-1 text-sm text-muted-foreground">
            New here? See{" "}
            <Link
              to="/app/whats-new"
              className="font-medium text-foreground underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-focus)]"
            >
              what this suite does
            </Link>{" "}
            — and what isn't switched on yet.
          </p>
          <button
            type="button"
            onClick={dismissBanner}
            aria-label="Dismiss"
            className="-m-1 shrink-0 rounded-[var(--radius)] p-1 text-muted-foreground transition-[color,background-color,border-color] duration-[var(--dur-fast)] ease-[var(--ease-out)] hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-focus)]"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* Ft2 · inline rule. Keeps a permanent route to the inventory so
          dismissing the banner doesn't orphan the page. */}
      <footer className="mt-[var(--space-2xl)] flex flex-wrap items-center justify-between gap-2 border-t border-border pt-[var(--space-md)] text-xs text-muted-foreground">
        <span>Q-Salon Suite · Doha</span>
        <Link
          to="/app/whats-new"
          className="underline underline-offset-4 transition-[color,background-color,border-color] duration-[var(--dur-fast)] ease-[var(--ease-out)] hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-focus)]"
        >
          What's in the suite
        </Link>
      </footer>
    </div>
  );
}
