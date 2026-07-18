import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  format,
  startOfMonth,
  endOfMonth,
  startOfDay,
  endOfDay,
  startOfWeek,
  endOfWeek,
  subMonths,
  eachDayOfInterval,
} from "date-fns";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  LineChart,
  Line,
  CartesianGrid,
  PieChart,
  Pie,
  Cell,
  Legend,
} from "recharts";
import { CalendarIcon, TrendingUp, Package, Users as UsersIcon, AlertTriangle } from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/hooks/use-tenant";
import { AppShell } from "@/components/app-shell";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
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
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/app/reports")({
  head: () => ({
    meta: [
      { title: "Reports — Q-Salon Suite" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: ReportsPage,
});

const CHART_COLORS = ["hsl(var(--accent))", "hsl(var(--primary))", "#8B7355", "#C89B7B", "#7A9E7E"];

function fmtQAR(n: number, currency = "QAR"): string {
  return `${currency} ${n.toLocaleString(undefined, { maximumFractionDigits: 2, minimumFractionDigits: 0 })}`;
}

type LocationRow = { id: string; name: string };
type Preset = "today" | "week" | "month" | "last_month" | "custom";

function ReportsPage() {
  const tenant = useTenant();
  const role = tenant.data?.primaryRole;

  if (tenant.isLoading) {
    return (
      <AppShell>
        <div className="p-8 space-y-4">
          <Skeleton className="h-10 w-64" />
          <Skeleton className="h-96 w-full" />
        </div>
      </AppShell>
    );
  }

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

function ReportsInner() {
  const tenant = useTenant();
  const role = tenant.data!.primaryRole!;
  const brandId = tenant.data!.brandId!;
  const managerLocationId = role === "manager" ? tenant.data!.locationId : null;

  const [preset, setPreset] = useState<Preset>("month");
  const [from, setFrom] = useState<Date>(startOfMonth(new Date()));
  const [to, setTo] = useState<Date>(endOfMonth(new Date()));
  const [locationId, setLocationId] = useState<string | "all">(managerLocationId ?? "all");

  const locationsQ = useQuery({
    queryKey: ["report-locations", brandId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("locations")
        .select("id, name")
        .eq("brand_id", brandId)
        .order("name");
      if (error) throw error;
      return (data ?? []) as LocationRow[];
    },
  });

  function applyPreset(p: Preset) {
    setPreset(p);
    const now = new Date();
    if (p === "today") { setFrom(startOfDay(now)); setTo(endOfDay(now)); }
    else if (p === "week") { setFrom(startOfWeek(now, { weekStartsOn: 1 })); setTo(endOfWeek(now, { weekStartsOn: 1 })); }
    else if (p === "month") { setFrom(startOfMonth(now)); setTo(endOfMonth(now)); }
    else if (p === "last_month") {
      const lm = subMonths(now, 1);
      setFrom(startOfMonth(lm)); setTo(endOfMonth(lm));
    }
  }

  const effectiveLocationId = role === "manager" ? managerLocationId : (locationId === "all" ? null : locationId);
  const rangeFromIso = startOfDay(from).toISOString();
  const rangeToIso = endOfDay(to).toISOString();

  return (
    <div className="p-8 space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl font-semibold">Reports</h1>
          <p className="text-sm text-muted-foreground">Revenue, stock and staff performance at a glance.</p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {role === "owner" && (
            <Select value={locationId} onValueChange={(v) => setLocationId(v as string)}>
              <SelectTrigger className="w-[200px]">
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

          <div className="flex rounded-md border border-border bg-card p-0.5">
            {[
              { k: "today" as Preset, label: "Today" },
              { k: "week" as Preset, label: "This week" },
              { k: "month" as Preset, label: "This month" },
              { k: "last_month" as Preset, label: "Last month" },
            ].map((p) => (
              <button
                key={p.k}
                onClick={() => applyPreset(p.k)}
                className={cn(
                  "px-3 py-1.5 text-xs font-medium rounded-sm transition-colors",
                  preset === p.k ? "bg-accent text-accent-foreground" : "text-muted-foreground hover:text-foreground"
                )}
              >
                {p.label}
              </button>
            ))}
          </div>

          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" size="sm" className="gap-2">
                <CalendarIcon className="h-4 w-4" />
                {format(from, "MMM d")} – {format(to, "MMM d, yyyy")}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0 pointer-events-auto" align="end">
              <Calendar
                mode="range"
                selected={{ from, to }}
                onSelect={(range) => {
                  if (range?.from) setFrom(range.from);
                  if (range?.to) setTo(range.to);
                  if (range?.from || range?.to) setPreset("custom");
                }}
                numberOfMonths={2}
                className="p-3 pointer-events-auto"
              />
            </PopoverContent>
          </Popover>
        </div>
      </div>

      <Tabs defaultValue="revenue" className="space-y-6">
        <TabsList>
          <TabsTrigger value="revenue"><TrendingUp className="mr-2 h-4 w-4" />Revenue</TabsTrigger>
          <TabsTrigger value="stock"><Package className="mr-2 h-4 w-4" />Stock</TabsTrigger>
          <TabsTrigger value="staff"><UsersIcon className="mr-2 h-4 w-4" />Staff performance</TabsTrigger>
        </TabsList>

        <TabsContent value="revenue">
          <RevenueReport
            brandId={brandId}
            locationId={effectiveLocationId}
            fromIso={rangeFromIso}
            toIso={rangeToIso}
            from={from}
            to={to}
          />
        </TabsContent>

        <TabsContent value="stock">
          <StockReport
            brandId={brandId}
            locationId={effectiveLocationId}
            role={role}
            fromIso={rangeFromIso}
            toIso={rangeToIso}
            locations={locationsQ.data ?? []}
          />
        </TabsContent>

        <TabsContent value="staff">
          <StaffReport
            brandId={brandId}
            locationId={effectiveLocationId}
            fromIso={rangeFromIso}
            toIso={rangeToIso}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// =========================================================
// REVENUE
// =========================================================

type IncomeRow = {
  id: string;
  amount: number;
  currency: string;
  method: "cash" | "card" | "bank_transfer";
  collected_at: string;
  appointment_id: string | null;
  location_id: string;
};

function RevenueReport({
  brandId, locationId, fromIso, toIso, from, to,
}: {
  brandId: string;
  locationId: string | null;
  fromIso: string;
  toIso: string;
  from: Date;
  to: Date;
}) {
  const q = useQuery({
    queryKey: ["report-revenue", brandId, locationId, fromIso, toIso],
    queryFn: async () => {
      let incomeQ = supabase
        .from("income_records")
        .select("id, amount, currency, method, collected_at, appointment_id, location_id")
        .eq("brand_id", brandId)
        .gte("collected_at", fromIso)
        .lte("collected_at", toIso);
      if (locationId) incomeQ = incomeQ.eq("location_id", locationId);

      const { data: incomeRaw, error: incErr } = await incomeQ;
      if (incErr) throw incErr;
      const income = (incomeRaw ?? []) as IncomeRow[];

      const apptIds = Array.from(new Set(income.map((i) => i.appointment_id).filter(Boolean))) as string[];

      let appts: { id: string; service_id: string | null; staff_user_id: string; status: string }[] = [];
      if (apptIds.length) {
        const { data, error } = await supabase
          .from("appointments")
          .select("id, service_id, staff_user_id, status")
          .in("id", apptIds);
        if (error) throw error;
        appts = data ?? [];
      }

      const serviceIds = Array.from(new Set(appts.map((a) => a.service_id).filter(Boolean))) as string[];
      const staffIds = Array.from(new Set(appts.map((a) => a.staff_user_id)));

      const [servicesRes, staffRes, apptCountRes] = await Promise.all([
        serviceIds.length
          ? supabase.from("services").select("id, name").in("id", serviceIds)
          : Promise.resolve({ data: [], error: null }),
        staffIds.length
          ? supabase.from("profiles").select("id, full_name, email").in("id", staffIds)
          : Promise.resolve({ data: [], error: null }),
        (() => {
          let c = supabase
            .from("appointments")
            .select("id", { count: "exact", head: true })
            .eq("brand_id", brandId)
            .eq("status", "completed")
            .gte("starts_at", fromIso)
            .lte("starts_at", toIso);
          if (locationId) c = c.eq("location_id", locationId);
          return c;
        })(),
      ]);
      if (servicesRes.error) throw servicesRes.error;
      if (staffRes.error) throw staffRes.error;

      const serviceMap = new Map<string, string>((servicesRes.data ?? []).map((s: any) => [s.id, s.name]));
      const staffMap = new Map<string, string>((staffRes.data ?? []).map((s: any) => [s.id, s.full_name || s.email || "—"]));
      const apptMap = new Map(appts.map((a) => [a.id, a]));

      const totalRevenue = income.reduce((s, r) => s + Number(r.amount), 0);
      const currency = income[0]?.currency ?? "QAR";
      const completedCount = apptCountRes.count ?? 0;
      const avgTicket = completedCount > 0 ? totalRevenue / completedCount : 0;

      // by service
      const byService = new Map<string, number>();
      const byStaff = new Map<string, number>();
      for (const r of income) {
        const a = r.appointment_id ? apptMap.get(r.appointment_id) : null;
        const sName = a?.service_id ? (serviceMap.get(a.service_id) ?? "Unknown") : "Uncategorised";
        byService.set(sName, (byService.get(sName) ?? 0) + Number(r.amount));
        if (a) {
          const stName = staffMap.get(a.staff_user_id) ?? "—";
          byStaff.set(stName, (byStaff.get(stName) ?? 0) + Number(r.amount));
        }
      }

      // daily buckets
      const days = eachDayOfInterval({ start: from, end: to });
      const dayMap = new Map<string, number>(days.map((d) => [format(d, "yyyy-MM-dd"), 0]));
      for (const r of income) {
        const k = format(new Date(r.collected_at), "yyyy-MM-dd");
        if (dayMap.has(k)) dayMap.set(k, dayMap.get(k)! + Number(r.amount));
      }
      const daily = Array.from(dayMap.entries()).map(([d, v]) => ({ date: format(new Date(d), "MMM d"), revenue: v }));

      // by method
      const byMethod: Record<string, number> = { cash: 0, card: 0, bank_transfer: 0 };
      for (const r of income) byMethod[r.method] = (byMethod[r.method] ?? 0) + Number(r.amount);

      return {
        totalRevenue,
        completedCount,
        avgTicket,
        currency,
        byService: Array.from(byService.entries()).map(([name, amount]) => ({ name, amount })).sort((a, b) => b.amount - a.amount),
        byStaff: Array.from(byStaff.entries()).map(([name, amount]) => ({ name, amount })).sort((a, b) => b.amount - a.amount),
        daily,
        methodData: Object.entries(byMethod).map(([name, value]) => ({ name: name.replace("_", " "), value })),
      };
    },
  });

  if (q.isLoading) return <Skeleton className="h-96 w-full" />;
  if (!q.data) return null;
  const d = q.data;

  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-3">
        <SummaryCard label="Total revenue" value={fmtQAR(d.totalRevenue, d.currency)} />
        <SummaryCard label="Appointments completed" value={d.completedCount.toLocaleString()} />
        <SummaryCard label="Average ticket" value={fmtQAR(d.avgTicket, d.currency)} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="font-display text-lg">Revenue over time</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={d.daily}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="date" tick={{ fontSize: 12 }} stroke="hsl(var(--muted-foreground))" />
                <YAxis tick={{ fontSize: 12 }} stroke="hsl(var(--muted-foreground))" />
                <Tooltip formatter={(v: number) => fmtQAR(v, d.currency)} />
                <Line type="monotone" dataKey="revenue" stroke={CHART_COLORS[0]} strokeWidth={2} dot={{ r: 3 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="font-display text-lg">By service</CardTitle>
          </CardHeader>
          <CardContent>
            {d.byService.length === 0 ? (
              <p className="text-sm text-muted-foreground">No revenue in this range.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow><TableHead>Service</TableHead><TableHead className="text-right">Revenue</TableHead></TableRow>
                </TableHeader>
                <TableBody>
                  {d.byService.slice(0, 10).map((s) => (
                    <TableRow key={s.name}><TableCell>{s.name}</TableCell><TableCell className="text-right font-medium">{fmtQAR(s.amount, d.currency)}</TableCell></TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="font-display text-lg">By staff</CardTitle>
          </CardHeader>
          <CardContent>
            {d.byStaff.length === 0 ? (
              <p className="text-sm text-muted-foreground">No revenue in this range.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow><TableHead>Staff</TableHead><TableHead className="text-right">Revenue</TableHead></TableRow>
                </TableHeader>
                <TableBody>
                  {d.byStaff.slice(0, 10).map((s) => (
                    <TableRow key={s.name}><TableCell>{s.name}</TableCell><TableCell className="text-right font-medium">{fmtQAR(s.amount, d.currency)}</TableCell></TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="font-display text-lg">Payment methods</CardTitle>
        </CardHeader>
        <CardContent>
          {d.totalRevenue === 0 ? (
            <p className="text-sm text-muted-foreground">No payments in this range.</p>
          ) : (
            <div className="h-56 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={d.methodData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={80} label={(e: any) => `${e.name}: ${fmtQAR(e.value, d.currency)}`}>
                    {d.methodData.map((_, i) => <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />)}
                  </Pie>
                  <Legend />
                  <Tooltip formatter={(v: number) => fmtQAR(v, d.currency)} />
                </PieChart>
              </ResponsiveContainer>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// =========================================================
// STOCK
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
        .lte("created_at", toIso);
      if (locationId) mvQ = mvQ.eq("location_id", locationId);
      const { data: movements, error: mErr } = await mvQ;
      if (mErr) throw mErr;

      const productMap = new Map((products ?? []).map((p: any) => [p.id, p]));
      const locationMap = new Map(locations.map((l) => [l.id, l.name]));

      // Stock value
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

      // Fastest moving
      const usageMap = new Map<string, number>();
      for (const m of movements ?? []) {
        usageMap.set(m.product_id, (usageMap.get(m.product_id) ?? 0) + Number(m.quantity));
      }
      const fastest = Array.from(usageMap.entries())
        .map(([pid, qty]) => ({ id: pid, name: productMap.get(pid)?.name ?? "Unknown", unit: productMap.get(pid)?.unit ?? "", qty }))
        .sort((a, b) => b.qty - a.qty)
        .slice(0, 10);

      // Low / out
      const lowStock = (stock ?? [])
        .map((row: any) => {
          const p = productMap.get(row.product_id);
          const qty = Number(row.quantity);
          const thr = Number(row.low_stock_threshold ?? 0);
          let status: "ok" | "low" | "out" = "ok";
          if (qty <= 0) status = "out";
          else if (qty <= thr) status = "low";
          return { productId: row.product_id, name: p?.name ?? "Unknown", unit: p?.unit ?? "", locationId: row.location_id, locationName: locationMap.get(row.location_id) ?? "—", quantity: qty, threshold: thr, status };
        })
        .filter((r) => r.status !== "ok")
        .sort((a, b) => (a.status === b.status ? a.quantity - b.quantity : a.status === "out" ? -1 : 1));

      return {
        totalValue,
        currency,
        byLocation: Array.from(byLocation.entries()).map(([lid, v]) => ({ location: locationMap.get(lid) ?? "—", value: v })),
        fastest,
        lowStock,
      };
    },
  });

  if (q.isLoading) return <Skeleton className="h-96 w-full" />;
  if (!q.data) return null;
  const d = q.data;

  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Current stock value {locationId ? "(this location)" : "(all locations)"}</CardDescription>
            <CardTitle className="font-display text-3xl">{fmtQAR(d.totalValue, d.currency)}</CardTitle>
          </CardHeader>
          {role === "owner" && !locationId && d.byLocation.length > 0 && (
            <CardContent className="pt-0">
              <ul className="space-y-1 text-sm">
                {d.byLocation.map((r) => (
                  <li key={r.location} className="flex justify-between">
                    <span className="text-muted-foreground">{r.location}</span>
                    <span className="font-medium">{fmtQAR(r.value, d.currency)}</span>
                  </li>
                ))}
              </ul>
            </CardContent>
          )}
        </Card>
        <SummaryCard label="Low / out of stock items" value={d.lowStock.length.toLocaleString()} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="font-display text-lg">Fastest-moving products</CardTitle>
          <CardDescription>Top usage in the selected range.</CardDescription>
        </CardHeader>
        <CardContent>
          {d.fastest.length === 0 ? (
            <p className="text-sm text-muted-foreground">No product usage in this range.</p>
          ) : (
            <div className="h-64 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={d.fastest} layout="vertical" margin={{ left: 40 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis type="number" tick={{ fontSize: 12 }} stroke="hsl(var(--muted-foreground))" />
                  <YAxis type="category" dataKey="name" tick={{ fontSize: 12 }} stroke="hsl(var(--muted-foreground))" width={120} />
                  <Tooltip formatter={(v: number, _n, p: any) => [`${v} ${p.payload.unit}`, "Used"]} />
                  <Bar dataKey="qty" fill={CHART_COLORS[0]} radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <div>
            <CardTitle className="font-display text-lg flex items-center gap-2"><AlertTriangle className="h-4 w-4 text-amber-600" />Low / out of stock</CardTitle>
            <CardDescription>Restock from the Stock module.</CardDescription>
          </div>
          <Button variant="outline" size="sm" asChild>
            <Link to="/app/stock">Open stock</Link>
          </Button>
        </CardHeader>
        <CardContent>
          {d.lowStock.length === 0 ? (
            <p className="text-sm text-muted-foreground">Everything is well stocked.</p>
          ) : (
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
                    <TableCell className="text-right">{r.quantity} {r.unit}</TableCell>
                    <TableCell className="text-right text-muted-foreground">{r.threshold}</TableCell>
                    <TableCell>
                      {r.status === "out"
                        ? <Badge variant="destructive">Out</Badge>
                        : <Badge className="bg-amber-100 text-amber-900 hover:bg-amber-100">Low</Badge>}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// =========================================================
// STAFF PERFORMANCE
// =========================================================

type SortKey = "revenue" | "completed" | "noShowRate" | "name";

function StaffReport({
  brandId, locationId, fromIso, toIso,
}: {
  brandId: string;
  locationId: string | null;
  fromIso: string;
  toIso: string;
}) {
  const [sortBy, setSortBy] = useState<SortKey>("revenue");

  const q = useQuery({
    queryKey: ["report-staff", brandId, locationId, fromIso, toIso],
    queryFn: async () => {
      let apptQ = supabase
        .from("appointments")
        .select("id, staff_user_id, status, starts_at, location_id")
        .eq("brand_id", brandId)
        .gte("starts_at", fromIso)
        .lte("starts_at", toIso);
      if (locationId) apptQ = apptQ.eq("location_id", locationId);
      const { data: appts, error: aErr } = await apptQ;
      if (aErr) throw aErr;

      let incQ = supabase
        .from("income_records")
        .select("amount, currency, appointment_id, location_id")
        .eq("brand_id", brandId)
        .gte("collected_at", fromIso)
        .lte("collected_at", toIso);
      if (locationId) incQ = incQ.eq("location_id", locationId);
      const { data: income, error: iErr } = await incQ;
      if (iErr) throw iErr;

      const staffIds = Array.from(new Set((appts ?? []).map((a) => a.staff_user_id)));
      const { data: profs, error: pErr } = staffIds.length
        ? await supabase.from("profiles").select("id, full_name, email").in("id", staffIds)
        : { data: [], error: null } as any;
      if (pErr) throw pErr;
      const nameMap = new Map<string, string>((profs ?? []).map((p: any) => [p.id, p.full_name || p.email || "—"]));

      const apptById = new Map((appts ?? []).map((a) => [a.id, a]));
      const revenueByStaff = new Map<string, number>();
      for (const r of income ?? []) {
        if (!r.appointment_id) continue;
        const a = apptById.get(r.appointment_id);
        if (!a) continue;
        revenueByStaff.set(a.staff_user_id, (revenueByStaff.get(a.staff_user_id) ?? 0) + Number(r.amount));
      }

      const perStaff = new Map<string, { completed: number; noShow: number; nonCancelled: number }>();
      for (const a of appts ?? []) {
        const cur = perStaff.get(a.staff_user_id) ?? { completed: 0, noShow: 0, nonCancelled: 0 };
        if (a.status !== "cancelled") cur.nonCancelled += 1;
        if (a.status === "completed") cur.completed += 1;
        if (a.status === "no_show") cur.noShow += 1;
        perStaff.set(a.staff_user_id, cur);
      }

      const currency = (income ?? [])[0]?.currency ?? "QAR";

      const rows = staffIds.map((id) => {
        const s = perStaff.get(id) ?? { completed: 0, noShow: 0, nonCancelled: 0 };
        return {
          id,
          name: nameMap.get(id) ?? "—",
          completed: s.completed,
          revenue: revenueByStaff.get(id) ?? 0,
          noShowRate: s.nonCancelled > 0 ? s.noShow / s.nonCancelled : 0,
        };
      });

      return { rows, currency };
    },
  });

  const sorted = useMemo(() => {
    if (!q.data) return [];
    const r = [...q.data.rows];
    r.sort((a, b) => {
      if (sortBy === "name") return a.name.localeCompare(b.name);
      if (sortBy === "completed") return b.completed - a.completed;
      if (sortBy === "noShowRate") return b.noShowRate - a.noShowRate;
      return b.revenue - a.revenue;
    });
    return r;
  }, [q.data, sortBy]);

  if (q.isLoading) return <Skeleton className="h-96 w-full" />;
  if (!q.data) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="font-display text-lg">Staff performance</CardTitle>
        <CardDescription>Cancelled appointments excluded from the no-show denominator.</CardDescription>
      </CardHeader>
      <CardContent>
        {sorted.length === 0 ? (
          <p className="text-sm text-muted-foreground">No appointments in this range.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <SortHead active={sortBy === "name"} onClick={() => setSortBy("name")}>Staff</SortHead>
                <SortHead active={sortBy === "completed"} onClick={() => setSortBy("completed")} className="text-right">Completed</SortHead>
                <SortHead active={sortBy === "revenue"} onClick={() => setSortBy("revenue")} className="text-right">Revenue</SortHead>
                <SortHead active={sortBy === "noShowRate"} onClick={() => setSortBy("noShowRate")} className="text-right">No-show rate</SortHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sorted.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="font-medium">{r.name}</TableCell>
                  <TableCell className="text-right">{r.completed}</TableCell>
                  <TableCell className="text-right">{fmtQAR(r.revenue, q.data.currency)}</TableCell>
                  <TableCell className="text-right">
                    <span className={cn(
                      "font-medium",
                      r.noShowRate >= 0.15 ? "text-red-700" : r.noShowRate >= 0.05 ? "text-amber-700" : "text-muted-foreground"
                    )}>
                      {(r.noShowRate * 100).toFixed(1)}%
                    </span>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

function SortHead({ children, active, onClick, className }: { children: React.ReactNode; active: boolean; onClick: () => void; className?: string }) {
  return (
    <TableHead className={className}>
      <button onClick={onClick} className={cn("inline-flex items-center gap-1 hover:text-foreground transition-colors", active ? "text-foreground font-semibold" : "text-muted-foreground")}>
        {children}
      </button>
    </TableHead>
  );
}

function SummaryCard({ label, value }: { label: string; value: string }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardDescription>{label}</CardDescription>
        <CardTitle className="font-display text-3xl">{value}</CardTitle>
      </CardHeader>
    </Card>
  );
}
