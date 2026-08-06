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
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { format, parseISO } from "date-fns";
import { AlertTriangle, ArrowLeft, CheckCircle2, ExternalLink } from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { errorMessage } from "@/lib/error-message";
import { PLAN_LIMITS, formatQar, EXTRA_LOCATION_ADDON, type PlanTier } from "@/lib/plan-limits";
import { looksApplied, describeApplied } from "@/lib/plan-request-status";
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
  current_addon_locations: number;
  requested_plan: PlanTier | null;
  requested_addon_locations_delta: number | null;
  status: "pending" | "processed" | "declined";
  notes: string | null;
  created_at: string;
  processed_at: string | null;
};

type BrandRef = { id: string; name: string; plan: PlanTier; addon_locations: number | null };
type ProfileRef = { id: string; full_name: string | null; email: string | null };
type CardRow = Row & { brand?: BrandRef; requester?: ProfileRef };

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
  row: CardRow;
  onResolve?: (status: "processed" | "declined") => void;
  busy?: boolean;
}) {
  const [confirming, setConfirming] = useState(false);

  const asked = row.requested_plan
    ? `Move to ${PLAN_LIMITS[row.requested_plan].label}`
    : `Add ${row.requested_addon_locations_delta} extra location${row.requested_addon_locations_delta === 1 ? "" : "s"}`;

  const price = row.requested_plan
    ? PLAN_LIMITS[row.requested_plan].priceMonthly
    : (row.requested_addon_locations_delta ?? 0) * EXTRA_LOCATION_ADDON.priceMonthly;

  const brandName = row.brand?.name ?? "this brand";
  const applied = looksApplied(row, row.brand);

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
          <div className="space-y-3 border-t border-slate-100 pt-3">
            {/* Step 1 of the flow, stated as a step. The original screen offered
                "Open brand" and "Mark processed" as two peer buttons, which read
                as alternatives rather than an order — and an admin reasonably
                clicked the one that sounded like "do the thing". */}
            {applied ? (
              <div className="flex items-start gap-2 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-emerald-900">
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                <div>
                  <div className="font-medium">Looks applied — safe to mark processed</div>
                  <div className="text-xs">{describeApplied(row, row.brand)}</div>
                </div>
              </div>
            ) : (
              <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-amber-900">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                <div>
                  <div className="font-medium">Not applied yet</div>
                  <div className="text-xs">
                    {describeApplied(row, row.brand)} Marking this processed will not change
                    anything — apply it on the brand first.
                  </div>
                </div>
              </div>
            )}

            <Button asChild className="w-full sm:w-auto">
              <Link to="/admin/brands/$id" params={{ id: row.brand_id }}>
                <ExternalLink className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
                Open {brandName}&rsquo;s billing settings to apply this change
              </Link>
            </Button>

            {/* Step 2. Two clicks, deliberately: a single-click "Mark processed"
                is what let the change be silently skipped. */}
            {!confirming ? (
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setConfirming(true)}
                  disabled={busy}
                >
                  Mark processed…
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => onResolve("declined")}
                  disabled={busy}
                >
                  Decline
                </Button>
              </div>
            ) : (
              <div className="space-y-2 rounded-md border border-slate-300 bg-slate-50 px-3 py-3">
                <p className="text-sm font-medium text-slate-900">This only closes the request.</p>
                <p className="text-xs text-slate-600">
                  It does not change anything about {brandName}. Make sure you have already updated
                  their plan on their billing settings page first — otherwise the owner will be told
                  their request was handled while nothing has changed.
                </p>
                <div className="flex flex-wrap gap-2 pt-1">
                  <Button
                    size="sm"
                    onClick={() => {
                      setConfirming(false);
                      onResolve("processed");
                    }}
                    disabled={busy}
                  >
                    Yes — I&rsquo;ve applied it, close the request
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setConfirming(false)}
                    disabled={busy}
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
