import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { startOfDay, endOfDay, startOfMonth, endOfMonth } from "date-fns";
import { CalendarClock, Users, Package, TrendingUp } from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/hooks/use-tenant";
import { AppShell } from "@/components/app-shell";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";

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

function Dashboard() {
  const tenant = useTenant();
  const brandId = tenant.data?.brandId ?? null;

  const kpis = useQuery({
    enabled: !!brandId,
    queryKey: ["dashboard-kpis", brandId],
    queryFn: async () => {
      const now = new Date();
      const dayStart = startOfDay(now).toISOString();
      const dayEnd = endOfDay(now).toISOString();
      const monthStart = startOfMonth(now).toISOString();
      const monthEnd = endOfMonth(now).toISOString();

      // Today's appointments (exclude cancelled)
      const apptRes = await supabase
        .from("appointments")
        .select("id", { count: "exact", head: true })
        .eq("brand_id", brandId!)
        .neq("status", "cancelled")
        .gte("starts_at", dayStart)
        .lte("starts_at", dayEnd);

      // Active clients (brand-wide)
      const clientsRes = await supabase
        .from("clients")
        .select("id", { count: "exact", head: true })
        .eq("brand_id", brandId!);

      // This month revenue
      const incomeRes = await supabase
        .from("income_records")
        .select("amount, currency")
        .eq("brand_id", brandId!)
        .gte("collected_at", monthStart)
        .lte("collected_at", monthEnd);

      const revenue = (incomeRes.data ?? []).reduce(
        (s, r) => s + Number(r.amount ?? 0),
        0,
      );
      const currency = (incomeRes.data?.[0]?.currency as string | undefined) ?? "QAR";

      // Low stock — find brand locations first, then count stock rows at/under threshold.
      const locRes = await supabase
        .from("locations")
        .select("id")
        .eq("brand_id", brandId!);
      const locIds = (locRes.data ?? []).map((l) => l.id);
      let lowStock = 0;
      if (locIds.length > 0) {
        const stockRes = await supabase
          .from("location_stock")
          .select("quantity, low_stock_threshold")
          .in("location_id", locIds);
        lowStock = (stockRes.data ?? []).filter(
          (r) => Number(r.quantity) <= Number(r.low_stock_threshold ?? 0),
        ).length;
      }

      return {
        todayAppointments: apptRes.count ?? 0,
        activeClients: clientsRes.count ?? 0,
        revenue,
        currency,
        lowStock,
      };
    },
  });

  const loading = kpis.isLoading;
  const data = kpis.data;

  const cards = [
    {
      label: "Today's appointments",
      value: loading ? null : String(data?.todayAppointments ?? 0),
      icon: CalendarClock,
      to: "/app/appointments" as const,
    },
    {
      label: "Revenue this month",
      value: loading
        ? null
        : `${data?.currency ?? "QAR"} ${(data?.revenue ?? 0).toLocaleString(undefined, {
            maximumFractionDigits: 2,
          })}`,
      icon: TrendingUp,
      to: "/app/reports" as const,
    },
    {
      label: "Active clients",
      value: loading ? null : String(data?.activeClients ?? 0),
      icon: Users,
      to: "/app/clients" as const,
    },
    {
      label: "Low stock items",
      value: loading ? null : String(data?.lowStock ?? 0),
      icon: Package,
      to: "/app/stock" as const,
    },
  ];

  return (
    <>
      <header className="border-b border-border bg-background/80 px-6 py-4 backdrop-blur md:px-10">
        <h1 className="font-display text-2xl font-semibold tracking-tight">
          Welcome back
          {tenant.data?.fullName ? `, ${tenant.data.fullName.split(" ")[0]}` : ""}
        </h1>
        <p className="text-sm text-muted-foreground">Here's your salon at a glance.</p>
      </header>

      <div className="p-6 md:p-10">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {cards.map((k) => (
            <Link key={k.label} to={k.to} className="block">
              <Card className="h-full transition-colors hover:border-accent/40">
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                    {k.label}
                  </CardTitle>
                  <k.icon className="h-4 w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                  {k.value === null ? (
                    <Skeleton className="h-9 w-24" />
                  ) : (
                    <div className="font-display text-3xl font-semibold">{k.value}</div>
                  )}
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>

        <Card className="mt-8">
          <CardHeader>
            <CardTitle className="font-display text-xl">Quick actions</CardTitle>
            <CardDescription>Jump straight into the busiest parts of your salon.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            <Button asChild>
              <Link to="/app/appointments">Open calendar</Link>
            </Button>
            <Button asChild variant="outline">
              <Link to="/app/clients">Manage clients</Link>
            </Button>
            <Button asChild variant="outline">
              <Link to="/app/stock">Check stock</Link>
            </Button>
            <Button asChild variant="outline">
              <Link to="/app/reports">View reports</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
