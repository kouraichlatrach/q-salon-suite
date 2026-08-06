/**
 * Plan-request queue — /admin/requests
 *
 * The notification mechanism for now: there is no working outbound email or
 * WhatsApp send (Section 10 is blocked on a paid Twilio account), so a visible
 * count on the admin header is how a request gets noticed.
 *
 * CRITICAL: "Mark processed" does NOT change the brand. It closes the request
 * only. The plan change itself is made on the existing /admin/brands/$id screen,
 * which is the write path guard_brand_billing_columns permits and which
 * supabase/tests/billing_guard_regression.sql covers. Building a second writer
 * here — even a convenient one that "just applies the request" — would create an
 * unguarded route to the billing columns and quietly undo bug class 12's fix.
 * The screen therefore links to the brand and asks the admin to come back.
 */
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { format, parseISO } from "date-fns";
import { ArrowLeft, ExternalLink } from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { errorMessage } from "@/lib/error-message";
import { PLAN_LIMITS, formatQar, EXTRA_LOCATION_ADDON, type PlanTier } from "@/lib/plan-limits";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

export const Route = createFileRoute("/_authenticated/admin/requests")({
  head: () => ({
    meta: [{ title: "Plan requests — Platform admin" }, { name: "robots", content: "noindex" }],
  }),
  component: RequestQueue,
});

type Row = {
  id: string;
  brand_id: string;
  requested_by: string;
  current_plan: PlanTier;
  requested_plan: PlanTier | null;
  requested_addon_locations_delta: number | null;
  status: "pending" | "processed" | "declined";
  notes: string | null;
  created_at: string;
  processed_at: string | null;
};

type BrandRef = { id: string; name: string; plan: PlanTier; addon_locations: number | null };
type ProfileRef = { id: string; full_name: string | null; email: string | null };

function RequestQueue() {
  const qc = useQueryClient();

  const q = useQuery({
    queryKey: ["admin-requests"],
    queryFn: async () => {
      const { data: reqs, error } = await supabase
        .from("plan_upgrade_requests")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;

      const brandIds = Array.from(new Set((reqs ?? []).map((r) => r.brand_id)));
      const userIds = Array.from(new Set((reqs ?? []).map((r) => r.requested_by)));
      const [brandRes, profRes] = await Promise.all([
        brandIds.length
          ? supabase.from("brands").select("id, name, plan, addon_locations").in("id", brandIds)
          : Promise.resolve({ data: [], error: null }),
        userIds.length
          ? supabase.from("profiles").select("id, full_name, email").in("id", userIds)
          : Promise.resolve({ data: [], error: null }),
      ]);
      const brandMap = new Map(((brandRes.data ?? []) as BrandRef[]).map((b) => [b.id, b]));
      const profMap = new Map(((profRes.data ?? []) as ProfileRef[]).map((p) => [p.id, p]));
      return (reqs as Row[]).map((r) => ({
        ...r,
        brand: brandMap.get(r.brand_id),
        requester: profMap.get(r.requested_by),
      }));
    },
  });

  const resolve = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: "processed" | "declined" }) => {
      const uid = (await supabase.auth.getUser()).data.user?.id;
      // Only these three columns are granted to `authenticated` on this table,
      // so this statement cannot touch anything else even by accident.
      const { error } = await supabase
        .from("plan_upgrade_requests")
        .update({ status, processed_at: new Date().toISOString(), processed_by: uid })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: (_d, v) => {
      qc.invalidateQueries({ queryKey: ["admin-requests"] });
      qc.invalidateQueries({ queryKey: ["admin-pending-requests"] });
      toast.success(v.status === "processed" ? "Marked processed" : "Request declined");
    },
    onError: (e) => toast.error(errorMessage(e, "Could not update the request")),
  });

  if (q.isLoading) return <Skeleton className="h-96 w-full" />;

  const rows = q.data ?? [];
  const pending = rows.filter((r) => r.status === "pending");
  const closed = rows.filter((r) => r.status !== "pending");

  return (
    <div className="space-y-6">
      <div>
        <Link
          to="/admin"
          className="inline-flex items-center gap-1 text-xs text-slate-500 hover:text-slate-800"
        >
          <ArrowLeft className="h-3 w-3" /> Back to brands
        </Link>
        <h1 className="mt-2 text-2xl font-semibold">Plan requests</h1>
        <p className="text-sm text-slate-500">
          Owners asking for a higher tier or more locations. Apply the change on the brand, then
          mark the request processed.
        </p>
      </div>

      <section className="space-y-3">
        <h2 className="text-sm font-medium text-slate-700">Pending ({pending.length})</h2>
        {pending.length === 0 ? (
          <p className="text-sm text-slate-500">Nothing waiting.</p>
        ) : (
          pending.map((r) => (
            <RequestCard
              key={r.id}
              row={r}
              onResolve={(status) => resolve.mutate({ id: r.id, status })}
              busy={resolve.isPending}
            />
          ))
        )}
      </section>

      {closed.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-sm font-medium text-slate-700">Answered</h2>
          {closed.map((r) => (
            <RequestCard key={r.id} row={r} />
          ))}
        </section>
      )}
    </div>
  );
}

function RequestCard({
  row,
  onResolve,
  busy,
}: {
  row: Row & { brand?: BrandRef; requester?: ProfileRef };
  onResolve?: (status: "processed" | "declined") => void;
  busy?: boolean;
}) {
  const asked = row.requested_plan
    ? `Move to ${PLAN_LIMITS[row.requested_plan].label}`
    : `Add ${row.requested_addon_locations_delta} extra location${row.requested_addon_locations_delta === 1 ? "" : "s"}`;

  const price = row.requested_plan
    ? PLAN_LIMITS[row.requested_plan].priceMonthly
    : (row.requested_addon_locations_delta ?? 0) * EXTRA_LOCATION_ADDON.priceMonthly;

  return (
    <Card className="bg-white">
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <CardTitle className="text-base">{row.brand?.name ?? "Unknown brand"}</CardTitle>
            <CardDescription>
              {row.requester?.full_name || row.requester?.email || "Unknown owner"} ·{" "}
              {format(parseISO(row.created_at), "d MMM yyyy, HH:mm")}
            </CardDescription>
          </div>
          {row.status === "pending" ? (
            <Badge variant="outline" className="border-amber-400 bg-amber-50 text-amber-900">
              Pending
            </Badge>
          ) : row.status === "processed" ? (
            <Badge variant="outline" className="border-emerald-400 bg-emerald-50 text-emerald-900">
              Processed
            </Badge>
          ) : (
            <Badge variant="outline">Declined</Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          <span className="font-medium">{asked}</span>
          <span className="text-slate-500">
            currently {PLAN_LIMITS[row.current_plan]?.label ?? row.current_plan}
            {row.brand?.addon_locations ? ` +${row.brand.addon_locations} extra` : ""}
          </span>
          {price !== null && price > 0 && (
            <span className="whitespace-nowrap text-slate-500">≈ {formatQar(price)}/mo</span>
          )}
        </div>

        {row.notes && (
          <p className="rounded-md bg-slate-50 px-3 py-2 text-slate-700" dir="auto">
            “{row.notes}”
          </p>
        )}

        {row.status === "pending" && onResolve && (
          <div className="flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3">
            <Button variant="outline" size="sm" asChild>
              <Link to="/admin/brands/$id" params={{ id: row.brand_id }}>
                <ExternalLink className="mr-1 h-3 w-3" /> Open brand to apply
              </Link>
            </Button>
            <Button size="sm" onClick={() => onResolve("processed")} disabled={busy}>
              Mark processed
            </Button>
            <Button variant="ghost" size="sm" onClick={() => onResolve("declined")} disabled={busy}>
              Decline
            </Button>
            <span className="w-full text-xs text-slate-500">
              Marking processed closes the request only — it does not change the brand. Make the
              change on the brand screen first.
            </span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
