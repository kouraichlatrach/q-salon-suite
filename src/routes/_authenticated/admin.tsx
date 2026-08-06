import { createFileRoute, Link, Outlet, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { format, differenceInDays, parseISO } from "date-fns";
import { Search, LogOut, Shield, ArrowUpDown, Inbox } from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/hooks/use-tenant";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
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
import { usePendingRequestCount } from "@/hooks/use-pending-requests";

export const Route = createFileRoute("/_authenticated/admin")({
  head: () => ({
    meta: [{ title: "Platform admin" }, { name: "robots", content: "noindex" }],
  }),
  component: AdminLayout,
});

function AdminLayout() {
  const tenant = useTenant();
  const navigate = useNavigate();

  useEffect(() => {
    if (!tenant.isLoading && tenant.data && !tenant.data.isPlatformAdmin) {
      navigate({ to: "/app", replace: true });
    }
  }, [tenant.isLoading, tenant.data, navigate]);

  if (tenant.isLoading || !tenant.data || !tenant.data.isPlatformAdmin) {
    return (
      <div className="min-h-screen bg-slate-50 p-8">
        <Skeleton className="h-8 w-48 mb-4" />
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }

  async function signOut() {
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-3">
          <Link to="/admin" className="flex items-center gap-2 text-sm font-semibold">
            <Shield className="h-4 w-4" />
            Platform admin
          </Link>
          <div className="flex items-center gap-3 text-xs text-slate-500">
            <PendingRequestsLink />
            <span>{tenant.data.email}</span>
            <button
              onClick={signOut}
              className="inline-flex items-center gap-1 rounded border border-slate-200 bg-white px-2 py-1 hover:bg-slate-100"
            >
              <LogOut className="h-3 w-3" /> Sign out
            </button>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-6 py-8">
        <Outlet />
      </main>
    </div>
  );
}

/**
 * The notification mechanism. There is no working outbound email or WhatsApp
 * send yet (Section 10 is blocked on a paid Twilio account), so a count in the
 * header is how an admin learns an owner has asked for something. It sits on
 * the layout rather than the brands list so it is visible from every admin
 * screen, including the brand detail page where the change gets made.
 */
function PendingRequestsLink() {
  const { data: pending = 0 } = usePendingRequestCount();
  return (
    <Link
      to="/admin/requests"
      className="inline-flex items-center gap-1.5 rounded border border-slate-200 bg-white px-2 py-1 hover:bg-slate-100"
    >
      <Inbox className="h-3 w-3" />
      Requests
      {pending > 0 && (
        <span className="ml-0.5 inline-flex min-w-4 items-center justify-center rounded-full bg-amber-500 px-1 text-[10px] font-semibold leading-4 text-white">
          {pending}
        </span>
      )}
    </Link>
  );
}

// Index component — rendered when child routes don't match
export function AdminBrandsList() {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [sortBy, setSortBy] = useState<"renewal" | "name" | "created">("renewal");

  const q = useQuery({
    queryKey: ["admin-brands"],
    queryFn: async () => {
      const { data: brands, error } = await supabase
        .from("brands")
        .select(
          "id, name, plan, subscription_status, billing_cycle, renewal_date, owner_user_id, max_staff_accounts, max_locations, created_at",
        );
      if (error) throw error;

      const ownerIds = Array.from(new Set((brands ?? []).map((b) => b.owner_user_id)));
      const brandIds = (brands ?? []).map((b) => b.id);

      const [profRes, locRes, staffRes] = await Promise.all([
        ownerIds.length
          ? supabase.from("profiles").select("id, full_name, email").in("id", ownerIds)
          : Promise.resolve({ data: [], error: null }),
        brandIds.length
          ? supabase.from("locations").select("brand_id").in("brand_id", brandIds)
          : Promise.resolve({ data: [], error: null }),
        brandIds.length
          ? supabase.from("user_roles").select("brand_id, role").in("brand_id", brandIds)
          : Promise.resolve({ data: [], error: null }),
      ]);
      if (profRes.error) throw profRes.error;
      if (locRes.error) throw locRes.error;
      if (staffRes.error) throw staffRes.error;

      const profMap = new Map((profRes.data ?? []).map((p: any) => [p.id, p]));
      const locCount = new Map<string, number>();
      for (const l of locRes.data ?? [])
        locCount.set(l.brand_id, (locCount.get(l.brand_id) ?? 0) + 1);
      const staffCount = new Map<string, number>();
      for (const r of staffRes.data ?? []) {
        if (r.role === "owner") continue;
        staffCount.set(r.brand_id, (staffCount.get(r.brand_id) ?? 0) + 1);
      }

      return (brands ?? []).map((b) => ({
        ...b,
        ownerName: profMap.get(b.owner_user_id)?.full_name ?? null,
        ownerEmail: profMap.get(b.owner_user_id)?.email ?? null,
        locationCount: locCount.get(b.id) ?? 0,
        staffAccounts: staffCount.get(b.id) ?? 0,
      }));
    },
  });

  const rows = useMemo(() => {
    const list = (q.data ?? []).filter((b) => {
      if (statusFilter !== "all" && b.subscription_status !== statusFilter) return false;
      if (!search) return true;
      const s = search.toLowerCase();
      return b.name.toLowerCase().includes(s) || (b.ownerEmail ?? "").toLowerCase().includes(s);
    });
    list.sort((a, b) => {
      if (sortBy === "name") return a.name.localeCompare(b.name);
      if (sortBy === "created") return (b.created_at ?? "").localeCompare(a.created_at ?? "");
      // renewal ascending, nulls last
      const av = a.renewal_date ?? "9999-12-31";
      const bv = b.renewal_date ?? "9999-12-31";
      return av.localeCompare(bv);
    });
    return list;
  }, [q.data, search, statusFilter, sortBy]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Brands</h1>
        <p className="text-sm text-slate-500">
          All brands across the platform. Sorted by renewal date — soonest first.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[240px] max-w-md">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-slate-400" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search brand or owner email"
            className="pl-8 bg-white"
          />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-[180px] bg-white">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            <SelectItem value="trial">Trial</SelectItem>
            <SelectItem value="active">Active</SelectItem>
            <SelectItem value="expiring">Expiring</SelectItem>
            <SelectItem value="expired">Expired</SelectItem>
          </SelectContent>
        </Select>
        <Select value={sortBy} onValueChange={(v) => setSortBy(v as any)}>
          <SelectTrigger className="w-[200px] bg-white">
            <ArrowUpDown className="h-3 w-3 mr-2" />
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="renewal">Renewal date (soonest)</SelectItem>
            <SelectItem value="name">Brand name</SelectItem>
            <SelectItem value="created">Recently created</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="rounded-lg border border-slate-200 bg-white overflow-hidden">
        {q.isLoading ? (
          <div className="p-6">
            <Skeleton className="h-64 w-full" />
          </div>
        ) : rows.length === 0 ? (
          <div className="p-8 text-center text-sm text-slate-500">No brands match.</div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Brand</TableHead>
                <TableHead>Owner</TableHead>
                <TableHead>Plan</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Cycle</TableHead>
                <TableHead>Renewal</TableHead>
                <TableHead className="text-right">Locations</TableHead>
                <TableHead className="text-right">Staff</TableHead>
                <TableHead>Created</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((b) => {
                const flag = renewalFlag(b.renewal_date, b.subscription_status);
                return (
                  <TableRow
                    key={b.id}
                    className={cn(
                      "hover:bg-slate-50",
                      flag === "overdue" && "bg-red-50/50",
                      flag === "soon" && "bg-amber-50/40",
                    )}
                  >
                    <TableCell>
                      <Link
                        to="/admin/brands/$id"
                        params={{ id: b.id }}
                        className="font-medium text-slate-900 hover:underline"
                      >
                        {b.name}
                      </Link>
                    </TableCell>
                    <TableCell>
                      <div className="text-sm">{b.ownerName ?? "—"}</div>
                      <div className="text-xs text-slate-500">{b.ownerEmail ?? "—"}</div>
                    </TableCell>
                    <TableCell>
                      <span className="capitalize">{b.plan}</span>
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={b.subscription_status} />
                    </TableCell>
                    <TableCell className="capitalize text-sm">{b.billing_cycle}</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <span className="text-sm">
                          {b.renewal_date ? format(parseISO(b.renewal_date), "MMM d, yyyy") : "—"}
                        </span>
                        {flag === "overdue" && (
                          <Badge className="bg-red-600 hover:bg-red-600">Overdue</Badge>
                        )}
                        {flag === "soon" && (
                          <Badge className="bg-amber-500 hover:bg-amber-500">Soon</Badge>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="text-right text-sm">
                      {b.locationCount} / {b.max_locations}
                    </TableCell>
                    <TableCell className="text-right text-sm">
                      {b.staffAccounts} / {b.max_staff_accounts}
                    </TableCell>
                    <TableCell className="text-sm text-slate-500">
                      {format(parseISO(b.created_at), "MMM d, yyyy")}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </div>
    </div>
  );
}

function renewalFlag(date: string | null, status: string): "overdue" | "soon" | null {
  if (status === "expired") return "overdue";
  if (!date) return null;
  const days = differenceInDays(parseISO(date), new Date());
  if (days < 0) return "overdue";
  if (days <= 7) return "soon";
  return null;
}

function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    trial: "bg-blue-100 text-blue-800 hover:bg-blue-100",
    active: "bg-emerald-100 text-emerald-800 hover:bg-emerald-100",
    expiring: "bg-amber-100 text-amber-800 hover:bg-amber-100",
    expired: "bg-red-100 text-red-800 hover:bg-red-100",
  };
  return <Badge className={cn("capitalize font-normal", styles[status] ?? "")}>{status}</Badge>;
}

export { StatusBadge, renewalFlag };
