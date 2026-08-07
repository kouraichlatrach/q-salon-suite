import { createFileRoute, Link, stripSearchParams, useNavigate } from "@tanstack/react-router";
import { zodValidator } from "@tanstack/zod-adapter";
import { useCallback, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { addDays, format } from "date-fns";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { AlertTriangle, Package, TrendingUp, Users as UsersIcon } from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/hooks/use-tenant";
import { AppShell } from "@/components/app-shell";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { MultiSelect, type MultiSelectOption } from "@/components/ui/multi-select";
import { DateRangeControl, REPORT_PRESETS } from "@/components/appointment-filters";
import {
  BreakdownBars,
  ReliabilityTable,
  RetentionSplit,
  TrendCharts,
  useChartPalette,
} from "@/components/report-charts";
import { formatMoney, splitMoney } from "@/lib/money";
import {
  APPOINTMENT_SEARCH_DEFAULTS,
  type AppointmentSearch,
  appointmentSearchSchema,
  parseList,
  REPORT_SCOPE_DENY,
  resolveRange,
  resolveReportLocationId,
  toList,
} from "@/lib/appointment-filters";
import {
  averageTicket,
  currenciesPresent,
  reliabilityBreakdown,
  retention,
  revenueBreakdown,
  revenueSeries,
  volumeSeries,
  type ApptRow,
  type IncomeRow,
} from "@/lib/report-stats";

export const Route = createFileRoute("/_authenticated/app/reports")({
  // Same URL-backed filter state as Appointments — a filtered report is a link
  // an Owner should be able to send to their accountant.
  validateSearch: zodValidator(appointmentSearchSchema),
  search: { middlewares: [stripSearchParams(APPOINTMENT_SEARCH_DEFAULTS)] },
  head: () => ({
    meta: [{ title: "Reports — Q-Salon Suite" }, { name: "robots", content: "noindex" }],
  }),
  component: ReportsPage,
});

type LocationRow = { id: string; name: string };

function useFilterPatch() {
  const navigate = useNavigate({ from: Route.fullPath });
  return useCallback(
    (patch: Partial<AppointmentSearch>) => {
      navigate({ search: (prev) => ({ ...prev, ...patch }), replace: true });
    },
    [navigate],
  );
}

function ReportsPage() {
  const tenant = useTenant();
  const role = tenant.data?.primaryRole;

  if (tenant.isLoading) {
    return (
      <AppShell>
        <div className="space-y-4 p-8">
          <Skeleton className="h-10 w-64" />
          <Skeleton className="h-96 w-full" />
        </div>
      </AppShell>
    );
  }

  // Unchanged gate: Reports stays Owner + Manager only. Receptionists and Staff
  // have never had access and this redesign does not widen that.
  if (role !== "owner" && role !== "manager") {
    return (
      <AppShell>
        <div className="p-8">
          <Card>
            <CardHeader>
              <CardTitle className="font-display text-xl">Not available</CardTitle>
              <CardDescription>Reports are only available to owners and managers.</CardDescription>
            </CardHeader>
          </Card>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <ReportsInner />
    </AppShell>
  );
}

/** PostgREST `in.(…)` rides in the query string, so long id lists need chunking. */
async function clientsSeenBefore(
  brandId: string,
  locationId: string | null,
  beforeIso: string,
  clientIds: string[],
): Promise<Set<string>> {
  const found = new Set<string>();
  for (let i = 0; i < clientIds.length; i += 150) {
    const chunk = clientIds.slice(i, i + 150);
    let q = supabase
      .from("appointments")
      .select("client_id")
      .eq("brand_id", brandId)
      .lt("starts_at", beforeIso)
      .neq("status", "cancelled")
      .in("client_id", chunk);
    // Same scope as the range query. Asking brand-wide for a location-scoped
    // Manager would reveal that a client has visited a location they cannot see.
    if (locationId) q = q.eq("location_id", locationId);
    const { data, error } = await q;
    if (error) throw error;
    for (const r of data ?? []) found.add(r.client_id as string);
  }
  return found;
}

function ReportsInner() {
  const tenant = useTenant();
  const role = tenant.data!.primaryRole!;
  const brandId = tenant.data!.brandId!;
  const tenantLoc = tenant.data!.locationId;

  const search = Route.useSearch();
  const patch = useFilterPatch();
  const { start, end } = resolveRange(search);

  const scope = resolveReportLocationId(role, tenantLoc, search.loc);
  const denied = scope === REPORT_SCOPE_DENY;
  const locationId = denied ? null : (scope as string | null);

  const locationsQ = useQuery({
    queryKey: ["report-locations", brandId, role, locationId],
    enabled: !denied,
    queryFn: async () => {
      let q = supabase.from("locations").select("id, name").eq("brand_id", brandId).order("name");
      // An Owner needs the whole list to populate the switcher. Everyone else
      // is pinned to one location and only needs its name — this used to be
      // skipped entirely for them, so the header had no name to show and fell
      // back to a generic label. Fetching just their own row keeps sibling
      // branch names out of a Manager's client memory for no benefit.
      if (role !== "owner") {
        if (!locationId) return [] as LocationRow[];
        q = q.eq("id", locationId);
      }
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as LocationRow[];
    },
  });

  const servicesQ = useQuery({
    queryKey: ["report-services", brandId],
    enabled: !denied,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("services")
        .select("id, name")
        .eq("brand_id", brandId)
        .order("name");
      if (error) throw error;
      return (data ?? []) as { id: string; name: string }[];
    },
  });

  // Bookable staff only, scoped to the location in view — the same rule the
  // Appointments picker uses, so a Manager's filter can never list colleagues
  // from a location they don't administer.
  const staffQ = useQuery({
    queryKey: ["report-staff", brandId, locationId],
    enabled: !denied,
    queryFn: async () => {
      let q = supabase
        .from("user_roles")
        .select("user_id, location_id")
        .eq("brand_id", brandId)
        .eq("role", "staff")
        .not("user_id", "is", null);
      if (locationId) q = q.eq("location_id", locationId);
      const { data, error } = await q;
      if (error) throw error;
      const ids = Array.from(new Set((data ?? []).map((r) => r.user_id).filter(Boolean))) as string[];
      if (ids.length === 0) return [] as { id: string; name: string }[];
      const { data: profs } = await supabase.from("profiles").select("id, full_name, email").in("id", ids);
      return (profs ?? []).map((p) => ({
        id: p.id as string,
        name: (p.full_name as string) || (p.email as string) || "—",
      }));
    },
  });

  const staffFilter = parseList(search.staff);
  const serviceFilter = parseList(search.service);
  const entityFiltered = staffFilter.length > 0 || serviceFilter.length > 0;

  const dataQ = useQuery({
    queryKey: [
      "report-data", brandId, locationId,
      start.toISOString(), end.toISOString(),
      search.staff, search.service,
    ],
    enabled: !denied,
    queryFn: async () => {
      // --- appointments in range, by starts_at
      let apptQ = supabase
        .from("appointments")
        .select("id, client_id, staff_user_id, service_id, status, starts_at, location_id")
        .eq("brand_id", brandId)
        .gte("starts_at", start.toISOString())
        .lt("starts_at", end.toISOString());
      if (locationId) apptQ = apptQ.eq("location_id", locationId);
      if (staffFilter.length) apptQ = apptQ.in("staff_user_id", staffFilter);
      if (serviceFilter.length) apptQ = apptQ.in("service_id", serviceFilter);
      const { data: apptData, error: apptErr } = await apptQ;
      if (apptErr) throw apptErr;
      const appts = (apptData ?? []) as ApptRow[];

      // --- income in range, by collected_at
      //
      // With a staff/service filter active the join is INNER, so income whose
      // appointment doesn't match drops out — money for someone else's visit
      // genuinely does not belong to "revenue for Amal". With no filter the
      // plain select keeps income whose visit falls outside the period, and it
      // surfaces as its own labelled row rather than vanishing.
      let incQ = supabase
        .from("income_records")
        .select(entityFiltered ? "amount, currency, collected_at, appointment_id, location_id, appointments!inner(id)" : "amount, currency, collected_at, appointment_id, location_id")
        .eq("brand_id", brandId)
        .gte("collected_at", start.toISOString())
        .lt("collected_at", end.toISOString());
      if (locationId) incQ = incQ.eq("location_id", locationId);
      if (staffFilter.length) incQ = incQ.in("appointments.staff_user_id", staffFilter);
      if (serviceFilter.length) incQ = incQ.in("appointments.service_id", serviceFilter);
      const { data: incData, error: incErr } = await incQ;
      if (incErr) throw incErr;
      const income = (incData ?? []) as unknown as IncomeRow[];

      // --- retention: has each in-range client been seen here before?
      const inRangeClients = Array.from(
        new Set(appts.filter((a) => a.status !== "cancelled").map((a) => a.client_id)),
      );
      const priorClients = inRangeClients.length
        ? await clientsSeenBefore(brandId, locationId, start.toISOString(), inRangeClients)
        : new Set<string>();

      // Names for whoever actually appears in the data — which is not the same
      // set as the filter options. The filter lists bookable staff only (you
      // must not be able to filter by an account that can't hold appointments),
      // but historic rows exist against Owner/Manager/Receptionist accounts
      // (the §4.13 cleanup found 125). Mapping only bookable staff rendered
      // those as "Unknown staff" — accurate but useless to an Owner asking who
      // earned what. No new exposure: these appointment rows are already
      // visible, this only resolves a name already reachable via profiles RLS.
      const actorIds = Array.from(new Set(appts.map((a) => a.staff_user_id).filter(Boolean)));
      const actorNames = new Map<string, string>();
      for (let i = 0; i < actorIds.length; i += 150) {
        const { data: profs } = await supabase
          .from("profiles")
          .select("id, full_name, email")
          .in("id", actorIds.slice(i, i + 150));
        for (const p of profs ?? []) {
          actorNames.set(p.id as string, (p.full_name as string) || (p.email as string) || "—");
        }
      }

      return { appts, income, priorClients, actorNames };
    },
  });

  // Memoised so the `?? []` fallback keeps a stable identity — otherwise every
  // render hands the name-map memos a brand-new array and they recompute.
  const services = useMemo(() => servicesQ.data ?? [], [servicesQ.data]);
  const staff = useMemo(() => staffQ.data ?? [], [staffQ.data]);
  const serviceName = useMemo(() => {
    const m = new Map(services.map((s) => [s.id, s.name]));
    return (id: string) => m.get(id) ?? "Unknown service";
  }, [services]);
  const staffName = useMemo(() => {
    const m = new Map(staff.map((s) => [s.id, s.name]));
    // Data-derived names win: they cover accounts that aren't bookable but do
    // hold historic appointments.
    for (const [id, name] of dataQ.data?.actorNames ?? []) m.set(id, name);
    return (id: string) => m.get(id) ?? "Unknown staff";
  }, [staff, dataQ.data]);

  const stats = useMemo(() => {
    if (!dataQ.data) return null;
    const { appts, income, priorClients } = dataQ.data;
    const apptById = new Map(appts.map((a) => [a.id, a]));

    const byService = revenueBreakdown(income, apptById, "service", serviceName);
    const byStaff = revenueBreakdown(income, apptById, "staff", staffName);
    const ticket = averageTicket(income, apptById);
    const vol = volumeSeries(appts, start, end);
    const rev = revenueSeries(income, vol.points, vol.bucket);
    const ret = retention(appts, priorClients);
    const currencies = currenciesPresent(income);

    return {
      byService,
      byStaff,
      ticket,
      vol,
      rev,
      ret,
      currency: currencies[0] ?? "QAR",
      mixedCurrency: currencies.length > 1,
      staffReliability: reliabilityBreakdown(appts, "staff", staffName),
      serviceReliability: reliabilityBreakdown(appts, "service", serviceName),
      completed: appts.filter((a) => a.status === "completed").length,
    };
  }, [dataQ.data, serviceName, staffName, start, end]);

  if (denied) {
    return (
      <div className="p-8">
        <Card>
          <CardHeader>
            <CardTitle className="font-display text-xl">No location assigned</CardTitle>
            <CardDescription>
              Reports are scoped to a location, and your account isn't attached to one yet. Ask an
              owner to assign you a location — we won't show brand-wide figures instead.
            </CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  const rangeLabel =
    search.preset === "month" || search.preset === "last_month"
      ? format(start, "MMMM yyyy")
      : `${format(start, "d MMM yyyy")} – ${format(addDays(end, -1), "d MMM yyyy")}`;

  const scopeLabel = locationId
    ? (locationsQ.data ?? []).find((l) => l.id === locationId)?.name ?? "This location"
    : "All locations";

  const staffOptions: MultiSelectOption[] = staff.map((s) => ({ value: s.id, label: s.name }));
  const serviceOptions: MultiSelectOption[] = services.map((s) => ({ value: s.id, label: s.name }));

  return (
    <div className="space-y-6 p-4 md:p-8">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl font-semibold">Reports</h1>
          <p className="text-sm text-muted-foreground">
            {scopeLabel} · {rangeLabel}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {role === "owner" && (locationsQ.data ?? []).length > 0 && (
            <Select value={search.loc || "all"} onValueChange={(v) => patch({ loc: v === "all" ? "" : v })}>
              <SelectTrigger className="h-9 w-[190px]">
                <SelectValue placeholder="Location" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All locations</SelectItem>
                {(locationsQ.data ?? []).map((l) => (
                  <SelectItem key={l.id} value={l.id}>{l.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <DateRangeControl
            search={search}
            onPatch={patch}
            presets={REPORT_PRESETS}
          />
        </div>
      </header>

      <div className="flex flex-wrap items-center gap-2">
        <MultiSelect
          label="Staff"
          options={staffOptions}
          selected={staffFilter}
          onChange={(next) => patch({ staff: toList(next) })}
          searchPlaceholder="Find a colleague…"
          emptyText="No bookable staff in scope."
          className="w-[9.5rem]"
        />
        <MultiSelect
          label="Service"
          options={serviceOptions}
          selected={serviceFilter}
          onChange={(next) => patch({ service: toList(next) })}
          searchPlaceholder="Find a service…"
          emptyText="No services."
          className="w-[9.5rem]"
        />
        {entityFiltered && (
          <>
            <span className="text-xs text-muted-foreground">
              Filtered — sales not tied to a matching appointment (gift cards, packages) are excluded.
            </span>
            <button
              type="button"
              onClick={() => patch({ staff: "", service: "" })}
              className="rounded px-1.5 py-0.5 text-xs text-muted-foreground underline underline-offset-2 transition-colors hover:text-foreground"
            >
              Clear
            </button>
          </>
        )}
      </div>

      {dataQ.isPending || !stats ? (
        <Skeleton className="h-96 w-full" />
      ) : (
        (() => {
          const revenueParts = splitMoney(stats.byService.total, stats.currency);
          const ticketParts = splitMoney(stats.ticket.value, stats.currency);
          return (
        <>
          {stats.mixedCurrency && (
            <p className="rounded-md border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900">
              ⚠ This period contains more than one currency. Totals below add them together and are
              not meaningful — filter to a single location to compare like with like.
            </p>
          )}

          {/* Hero stat band. Hairline grid over a border-coloured background, not
              floating cards — a dashboard reads as one instrument. */}
          <div className="grid gap-px overflow-hidden rounded-lg border border-border bg-border sm:grid-cols-2 lg:grid-cols-4">
            <HeroStat
              label="Revenue collected"
              value={revenueParts.amount}
              unit={revenueParts.unit}
              hint="Counted when the money arrived"
              lead
            />
            <HeroStat
              label="Appointments completed"
              value={stats.completed.toLocaleString()}
              hint="Counted by visit date"
            />
            <HeroStat
              label="Average per paying visit"
              value={ticketParts.amount}
              unit={ticketParts.unit}
              hint={`${stats.ticket.visits} visit${stats.ticket.visits === 1 ? "" : "s"} took payment`}
            />
            <HeroStat
              label="First-time clients"
              value={stats.ret.newClients.toLocaleString()}
              hint={`of ${stats.ret.totalClients} who attended`}
            />
          </div>

          <Tabs defaultValue="revenue" className="space-y-4">
            {/* Three tabs with icons exceed 320px; scroll rather than clip. */}
            <TabsList className="max-w-full justify-start overflow-x-auto">
              <TabsTrigger value="revenue">
                <TrendingUp aria-hidden className="mr-2 h-4 w-4" />Revenue
              </TabsTrigger>
              <TabsTrigger value="performance">
                <UsersIcon aria-hidden className="mr-2 h-4 w-4" />Performance
              </TabsTrigger>
              <TabsTrigger value="stock">
                <Package aria-hidden className="mr-2 h-4 w-4" />Stock
              </TabsTrigger>
            </TabsList>

            <TabsContent value="revenue" className="space-y-px overflow-hidden rounded-lg border border-border bg-border">
              <TrendCharts
                revenue={stats.rev}
                volume={stats.vol.points}
                currency={stats.currency}
                bucket={stats.vol.bucket}
              />
              <div className="grid gap-px bg-border md:grid-cols-2">
                <BreakdownBars
                  title="Revenue by service"
                  rows={stats.byService.rows}
                  total={stats.byService.total}
                  currency={stats.currency}
                  colorIndex={0}
                  emptyText="No revenue in this period."
                />
                <BreakdownBars
                  title="Revenue by staff"
                  note="Sums to the same total as by-service. Money collected in this period for a visit outside it appears in both as one labelled row, rather than being attributed to a guess."
                  rows={stats.byStaff.rows}
                  total={stats.byStaff.total}
                  currency={stats.currency}
                  colorIndex={1}
                  emptyText="No revenue in this period."
                />
              </div>
            </TabsContent>

            <TabsContent value="performance" className="space-y-px overflow-hidden rounded-lg border border-border bg-border">
              <RetentionSplit
                newClients={stats.ret.newClients}
                returningClients={stats.ret.returningClients}
                totalClients={stats.ret.totalClients}
                scopeNote={
                  locationId
                    ? "“Returning” means the client has attended this location before. Visits to other locations aren't counted here, and aren't visible from this scope."
                    : "“Returning” means the client has attended this brand before the selected period."
                }
              />
              <div className="grid gap-px bg-border md:grid-cols-2">
                <ReliabilityTable
                  title="Reliability by staff"
                  rows={stats.staffReliability}
                  entityLabel="Staff"
                  emptyText="No appointments in this period."
                />
                <ReliabilityTable
                  title="Reliability by service"
                  rows={stats.serviceReliability}
                  entityLabel="Service"
                  emptyText="No appointments in this period."
                />
              </div>
            </TabsContent>

            <TabsContent value="stock">
              <StockReport
                brandId={brandId}
                locationId={locationId}
                role={role}
                fromIso={start.toISOString()}
                toIso={end.toISOString()}
                locations={locationsQ.data ?? []}
              />
            </TabsContent>
          </Tabs>
        </>
          );
        })()
      )}
    </div>
  );
}

function HeroStat({
  label, value, unit, hint, lead = false,
}: {
  label: string;
  value: string;
  /** Rendered smaller beside the figure, never on its own line. */
  unit?: string;
  hint: string;
  lead?: boolean;
}) {
  return (
    <div className="bg-card p-4 md:p-5">
      <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</div>
      {/* `whitespace-nowrap` as well as `[overflow-wrap:normal]`: the latter
          stops a break inside the numeral, the former stops one at the space
          before the currency. A figure never wraps (design.md · Typography). */}
      <div
        className={`tnum mt-1 whitespace-nowrap font-display font-semibold [overflow-wrap:normal] ${
          lead ? "text-3xl leading-none md:text-4xl" : "text-2xl"
        }`}
      >
        {value}
        {unit && (
          <span className={`ml-1 font-normal text-muted-foreground ${lead ? "text-base" : "text-sm"}`}>
            {unit}
          </span>
        )}
      </div>
      <div className="mt-1 text-xs text-muted-foreground">{hint}</div>
    </div>
  );
}

// =========================================================
// STOCK — unchanged behaviour, re-skinned to the hairline grid
// =========================================================

function StockReport({
  brandId, locationId, role, fromIso, toIso, locations,
}: {
  brandId: string;
  locationId: string | null;
  role: "owner" | "manager" | "receptionist" | "staff";
  fromIso: string;
  toIso: string;
  locations: LocationRow[];
}) {
  const palette = useChartPalette();
  const q = useQuery({
    queryKey: ["report-stock", brandId, locationId, fromIso, toIso],
    queryFn: async () => {
      const { data: products, error: pErr } = await supabase
        .from("products")
        .select("id, name, cost_price, currency, unit")
        .eq("brand_id", brandId);
      if (pErr) throw pErr;

      let stockQ = supabase
        .from("location_stock")
        .select("location_id, product_id, quantity, low_stock_threshold");
      if (locationId) stockQ = stockQ.eq("location_id", locationId);
      const { data: stock, error: sErr } = await stockQ;
      if (sErr) throw sErr;

      let mvQ = supabase
        .from("stock_movements")
        .select("product_id, location_id, quantity, movement_type, created_at")
        .eq("movement_type", "usage")
        .gte("created_at", fromIso)
        .lt("created_at", toIso);
      if (locationId) mvQ = mvQ.eq("location_id", locationId);
      const { data: movements, error: mErr } = await mvQ;
      if (mErr) throw mErr;

      const productMap = new Map((products ?? []).map((p) => [p.id, p] as const));
      const locationMap = new Map(locations.map((l) => [l.id, l.name]));

      let totalValue = 0;
      const byLocation = new Map<string, number>();
      const currency = (products ?? [])[0]?.currency ?? "QAR";
      for (const row of stock ?? []) {
        const p = productMap.get(row.product_id);
        if (!p) continue;
        const v = Number(row.quantity) * Number(p.cost_price ?? 0);
        totalValue += v;
        byLocation.set(row.location_id, (byLocation.get(row.location_id) ?? 0) + v);
      }

      const usageMap = new Map<string, number>();
      for (const m of movements ?? []) {
        usageMap.set(m.product_id, (usageMap.get(m.product_id) ?? 0) + Number(m.quantity));
      }
      const fastest = Array.from(usageMap.entries())
        .map(([pid, qty]) => ({
          id: pid,
          name: productMap.get(pid)?.name ?? "Unknown",
          unit: productMap.get(pid)?.unit ?? "",
          qty,
        }))
        .sort((a, b) => b.qty - a.qty)
        .slice(0, 10);

      const lowStock = (stock ?? [])
        .map((row) => {
          const p = productMap.get(row.product_id);
          const qty = Number(row.quantity);
          const thr = Number(row.low_stock_threshold ?? 0);
          let status: "ok" | "low" | "out" = "ok";
          if (qty <= 0) status = "out";
          else if (qty <= thr) status = "low";
          return {
            productId: row.product_id,
            name: p?.name ?? "Unknown",
            unit: p?.unit ?? "",
            locationId: row.location_id,
            locationName: locationMap.get(row.location_id) ?? "—",
            quantity: qty,
            threshold: thr,
            status,
          };
        })
        .filter((r) => r.status !== "ok")
        .sort((a, b) => (a.status === b.status ? a.quantity - b.quantity : a.status === "out" ? -1 : 1));

      return {
        totalValue,
        currency,
        byLocation: Array.from(byLocation.entries()).map(([lid, v]) => ({
          location: locationMap.get(lid) ?? "—",
          value: v,
        })),
        fastest,
        lowStock,
      };
    },
  });

  if (q.isPending) return <Skeleton className="h-96 w-full" />;
  if (!q.data) return null;
  const d = q.data;

  return (
    <div className="space-y-4">
      <div className="grid gap-px overflow-hidden rounded-lg border border-border bg-border sm:grid-cols-2">
        <div className="bg-card p-4 md:p-5">
          <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Current stock value {locationId ? "(this location)" : "(all locations)"}
          </div>
          <div className="tnum mt-1 font-display text-2xl font-semibold [overflow-wrap:normal]">
            {formatMoney(d.totalValue, d.currency)}
          </div>
          {role === "owner" && !locationId && d.byLocation.length > 0 && (
            <ul className="mt-2 space-y-1 text-sm">
              {d.byLocation.map((r) => (
                <li key={r.location} className="flex justify-between gap-3">
                  <span className="min-w-0 truncate text-muted-foreground">{r.location}</span>
                  <span className="tnum shrink-0 font-medium [overflow-wrap:normal]">
                    {formatMoney(r.value, d.currency)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="bg-card p-4 md:p-5">
          <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Low / out of stock items
          </div>
          <div className="tnum mt-1 font-display text-2xl font-semibold [overflow-wrap:normal]">
            {d.lowStock.length.toLocaleString()}
          </div>
        </div>
      </div>

      <section className="rounded-lg border border-border bg-card p-4 md:p-5">
        <h3 className="font-display text-base font-semibold">Fastest-moving products</h3>
        <p className="mt-0.5 text-xs text-muted-foreground">Top usage in the selected period.</p>
        {d.fastest.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            No product usage in this period.
          </p>
        ) : (
          <div className="mt-3 h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={d.fastest} layout="vertical" margin={{ left: 8, right: 8 }}>
                <CartesianGrid stroke="var(--color-border)" horizontal={false} />
                <XAxis type="number" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
                <YAxis
                  type="category"
                  dataKey="name"
                  tick={{ fontSize: 11 }}
                  tickLine={false}
                  axisLine={false}
                  width={120}
                />
                <Tooltip
                  cursor={{ fill: "var(--color-muted)" }}
                  contentStyle={{
                    background: "var(--color-card)",
                    border: "1px solid var(--color-border)",
                    borderRadius: 8,
                    fontSize: 12,
                  }}
                  formatter={(v: number, _n, p: { payload?: { unit?: string } }) =>
                    [`${v} ${p.payload?.unit ?? ""}`.trim(), "Used"] as [string, string]
                  }
                />
                <Bar dataKey="qty" fill={palette[2]} radius={[0, 4, 4, 0]} maxBarSize={22} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </section>

      <section className="rounded-lg border border-border bg-card p-4 md:p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="flex items-center gap-2 font-display text-base font-semibold">
              <AlertTriangle aria-hidden className="h-4 w-4 text-amber-600" />
              Low / out of stock
            </h3>
            <p className="mt-0.5 text-xs text-muted-foreground">Restock from the Stock module.</p>
          </div>
          <Button variant="outline" size="sm" asChild>
            <Link to="/app/stock">Open stock</Link>
          </Button>
        </div>
        {d.lowStock.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">Everything is well stocked.</p>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Product</TableHead>
                  {!locationId && <TableHead>Location</TableHead>}
                  <TableHead className="text-right">Quantity</TableHead>
                  <TableHead className="text-right">Threshold</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {d.lowStock.map((r) => (
                  <TableRow key={`${r.productId}-${r.locationId}`}>
                    <TableCell>{r.name}</TableCell>
                    {!locationId && <TableCell className="text-muted-foreground">{r.locationName}</TableCell>}
                    <TableCell className="tnum text-right [overflow-wrap:normal]">
                      {r.quantity} {r.unit}
                    </TableCell>
                    <TableCell className="tnum text-right text-muted-foreground [overflow-wrap:normal]">
                      {r.threshold}
                    </TableCell>
                    <TableCell>
                      {r.status === "out" ? (
                        <Badge variant="destructive">Out</Badge>
                      ) : (
                        <Badge className="bg-amber-100 text-amber-900 hover:bg-amber-100">Low</Badge>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </section>
    </div>
  );
}
