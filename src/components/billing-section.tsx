/**
 * Billing — the Owner's view of what they're on, what they're using, and how to
 * ask for more.
 *
 * There is no payment step and no plan change here, deliberately. Subscription
 * billing (Payments Phase C) is not built, and `guard_brand_billing_columns`
 * makes plan/limits/add-ons unwritable by an Owner on purpose. So this screen
 * records a REQUEST; a Platform Admin applies it by hand through /admin. The
 * copy says so plainly rather than implying an instant upgrade, because an
 * owner who clicks "Request upgrade" and sees nothing change would reasonably
 * assume it failed.
 *
 * Every limit, price and tier name is read from plan-limits.ts. Nothing here
 * retypes a number the database enforces — the old landing page did exactly
 * that and walled owners in two staff seats early.
 */
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { format, parseISO } from "date-fns";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { errorMessage } from "@/lib/error-message";
import {
  EXTRA_LOCATION_ADDON,
  PLAN_LIMITS,
  PLAN_ORDER,
  formatQar,
  isUnlimited,
  type PlanTier,
} from "@/lib/plan-limits";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type RequestRow = {
  id: string;
  current_plan: PlanTier;
  requested_plan: PlanTier | null;
  requested_addon_locations_delta: number | null;
  status: "pending" | "processed" | "declined";
  notes: string | null;
  created_at: string;
  processed_at: string | null;
};

export function BillingSection({ brandId }: { brandId: string }) {
  const qc = useQueryClient();
  const [mode, setMode] = useState<"tier" | "addon">("tier");
  const [targetTier, setTargetTier] = useState<string>("");
  const [addonDelta, setAddonDelta] = useState("1");
  const [note, setNote] = useState("");

  const { data, isLoading } = useQuery({
    queryKey: ["billing-overview", brandId],
    queryFn: async () => {
      const { data: brand, error } = await supabase
        .from("brands")
        .select(
          "plan, subscription_status, billing_cycle, renewal_date, max_locations, max_staff_accounts, addon_locations",
        )
        .eq("id", brandId)
        .single();
      if (error) throw error;

      // Same two counts the /admin brand detail uses to decide whether limits
      // are exceeded. Staff excludes the Owner's own login, matching
      // enforce_staff_plan_limit — otherwise an owner reads one seat short.
      const [locRes, roleRes] = await Promise.all([
        supabase
          .from("locations")
          .select("id", { count: "exact", head: true })
          .eq("brand_id", brandId),
        supabase.from("user_roles").select("role").eq("brand_id", brandId),
      ]);
      if (roleRes.error) throw roleRes.error;

      return {
        brand,
        locationCount: locRes.count ?? 0,
        staffAccounts: (roleRes.data ?? []).filter((r) => r.role !== "owner").length,
      };
    },
  });

  const { data: history = [] } = useQuery({
    queryKey: ["billing-requests", brandId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("plan_upgrade_requests")
        .select(
          "id, current_plan, requested_plan, requested_addon_locations_delta, status, notes, created_at, processed_at",
        )
        .eq("brand_id", brandId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as RequestRow[];
    },
  });

  const plan = (data?.brand.plan ?? "starter") as PlanTier;
  const limits = PLAN_LIMITS[plan];

  // Tiers above the current one, in the order plan-limits.ts declares. Reading
  // PLAN_ORDER rather than listing tiers here means a new tier appears without
  // anyone remembering to edit this file.
  const upgradeOptions = useMemo(() => {
    const i = PLAN_ORDER.indexOf(plan);
    return i < 0 ? [] : PLAN_ORDER.slice(i + 1);
  }, [plan]);

  const hasPending = history.some((r) => r.status === "pending");

  const submit = useMutation({
    mutationFn: async () => {
      const uid = (await supabase.auth.getUser()).data.user?.id;
      if (!uid) throw new Error("Your session expired — sign in again.");

      let requestedPlan: PlanTier | null = null;
      let addonDeltaValue: number | null = null;
      if (mode === "tier") {
        if (!targetTier) throw new Error("Choose the plan you'd like to move to.");
        requestedPlan = targetTier as PlanTier;
      } else {
        const n = Number(addonDelta);
        if (!Number.isInteger(n) || n < 1 || n > 50) {
          throw new Error("Extra locations must be a whole number between 1 and 50.");
        }
        addonDeltaValue = n;
      }

      const { error } = await supabase.from("plan_upgrade_requests").insert({
        brand_id: brandId,
        requested_by: uid,
        // Stamped from the database by a BEFORE INSERT trigger; sent only to
        // satisfy the NOT NULL. Whatever goes up here is overwritten.
        current_plan: plan,
        requested_plan: requestedPlan,
        requested_addon_locations_delta: addonDeltaValue,
        notes: note.trim() || null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["billing-requests", brandId] });
      setNote("");
      setTargetTier("");
      toast.success("Request sent", {
        description: "Our team will follow up to arrange billing.",
      });
    },
    onError: (e) => toast.error(errorMessage(e, "Could not send the request")),
  });

  if (isLoading || !data) return <Skeleton className="mb-6 h-64 w-full" />;

  const locationAllowance = data.brand.max_locations + (data.brand.addon_locations ?? 0);

  return (
    <>
      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="font-display">Billing</CardTitle>
          <CardDescription>
            Your plan, what you&rsquo;re using of it, and how to ask for more.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-display text-2xl">{limits.label}</span>
            <Badge variant="outline">{data.brand.subscription_status}</Badge>
            {limits.priceMonthly !== null && (
              <span className="whitespace-nowrap text-sm text-muted-foreground tnum [overflow-wrap:normal]">
                {data.brand.billing_cycle === "yearly" && limits.priceYearly !== null
                  ? `${formatQar(limits.priceYearly)} / year`
                  : `${formatQar(limits.priceMonthly)} / month`}
              </span>
            )}
            {data.brand.renewal_date && (
              <span className="whitespace-nowrap text-sm text-muted-foreground tnum [overflow-wrap:normal]">
                · renews {format(parseISO(data.brand.renewal_date), "d MMM yyyy")}
              </span>
            )}
          </div>

          <div className="grid grid-cols-1 gap-px overflow-hidden rounded-lg border border-border bg-border sm:grid-cols-2">
            <UsageCell
              label="Locations"
              used={data.locationCount}
              allowance={locationAllowance}
              addon={data.brand.addon_locations ?? 0}
            />
            <UsageCell
              label="Staff accounts"
              used={data.staffAccounts}
              allowance={data.brand.max_staff_accounts}
            />
          </div>
          <p className="text-xs text-muted-foreground">
            Staff accounts exclude your own owner login.
          </p>
        </CardContent>
      </Card>

      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="font-display">Request a change</CardTitle>
          <CardDescription>
            Plans are arranged with our team — nothing is charged from this screen.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {hasPending && (
            <div className="rounded-md border border-border bg-muted/40 px-3 py-2 text-sm">
              You already have a request waiting. Sending another is fine — we&rsquo;ll read both.
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            <Button
              variant={mode === "tier" ? "secondary" : "outline"}
              size="sm"
              onClick={() => setMode("tier")}
              className="whitespace-nowrap"
              disabled={upgradeOptions.length === 0}
            >
              Move to a higher plan
            </Button>
            <Button
              variant={mode === "addon" ? "secondary" : "outline"}
              size="sm"
              onClick={() => setMode("addon")}
              className="whitespace-nowrap"
              disabled={!limits.addonEligible}
            >
              Add extra locations
            </Button>
          </div>

          {mode === "tier" &&
            (upgradeOptions.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                You&rsquo;re on {limits.label}, our highest tier. To change anything about it, send
                a note below and we&rsquo;ll be in touch.
              </p>
            ) : (
              <div className="space-y-1">
                <Label>Move to</Label>
                <Select value={targetTier} onValueChange={setTargetTier}>
                  <SelectTrigger className="max-w-sm">
                    <SelectValue placeholder="Choose a plan" />
                  </SelectTrigger>
                  <SelectContent>
                    {upgradeOptions.map((t) => {
                      const l = PLAN_LIMITS[t];
                      return (
                        <SelectItem key={t} value={t}>
                          {l.label}
                          {l.priceMonthly !== null
                            ? ` — ${formatQar(l.priceMonthly)}/mo`
                            : " — talk to us"}
                        </SelectItem>
                      );
                    })}
                  </SelectContent>
                </Select>
                {targetTier && (
                  <p className="pt-1 text-xs text-muted-foreground">
                    {describeTier(targetTier as PlanTier)}
                  </p>
                )}
              </div>
            ))}

          {mode === "addon" &&
            (limits.addonEligible ? (
              <div className="space-y-1">
                <Label htmlFor="addon-delta">Extra locations to add</Label>
                <Input
                  id="addon-delta"
                  type="number"
                  min={1}
                  max={50}
                  value={addonDelta}
                  onChange={(e) => setAddonDelta(e.target.value)}
                  className="max-w-32 tnum [overflow-wrap:normal]"
                />
                <p className="pt-1 text-xs text-muted-foreground">
                  {formatQar(EXTRA_LOCATION_ADDON.priceMonthly)} per extra location, per month. You
                  currently have {data.brand.addon_locations ?? 0}.
                </p>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                {limits.label} already includes unlimited locations.
              </p>
            ))}

          <div className="space-y-1">
            <Label htmlFor="request-note">Anything we should know? (optional)</Label>
            <Textarea
              id="request-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              dir="auto"
              rows={3}
              placeholder="Opening a second branch in March…"
            />
          </div>

          <Button
            onClick={() => submit.mutate()}
            disabled={submit.isPending || (mode === "tier" && !targetTier)}
            className="whitespace-nowrap"
          >
            {submit.isPending ? "Sending…" : "Send request"}
          </Button>
        </CardContent>
      </Card>

      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="font-display">Your requests</CardTitle>
        </CardHeader>
        <CardContent>
          {history.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              You haven&rsquo;t asked for anything yet.
            </p>
          ) : (
            <ul className="space-y-2">
              {history.map((r) => (
                <li key={r.id} className="rounded-md border border-border px-3 py-2 text-sm">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-medium">{describeRequest(r)}</span>
                    <RequestStatus status={r.status} />
                  </div>
                  <div className="mt-1 whitespace-nowrap text-xs text-muted-foreground tnum [overflow-wrap:normal]">
                    Sent {format(parseISO(r.created_at), "d MMM yyyy")}
                    {r.processed_at
                      ? ` · answered ${format(parseISO(r.processed_at), "d MMM yyyy")}`
                      : ""}
                  </div>
                  {r.notes && (
                    <p className="mt-1 text-xs text-muted-foreground" dir="auto">
                      “{r.notes}”
                    </p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </>
  );
}

function UsageCell({
  label,
  used,
  allowance,
  addon,
}: {
  label: string;
  used: number;
  allowance: number;
  addon?: number;
}) {
  const unlimited = isUnlimited(allowance);
  const atLimit = !unlimited && used >= allowance;
  return (
    <div className="bg-background p-4">
      <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="mt-1 whitespace-nowrap font-display text-xl tnum [overflow-wrap:normal]">
        {used}{" "}
        <span className="text-muted-foreground">/ {unlimited ? "unlimited" : allowance}</span>
      </div>
      {addon ? (
        <div className="mt-1 text-xs text-muted-foreground">includes {addon} extra purchased</div>
      ) : null}
      {atLimit && (
        <div className="mt-1 text-xs text-muted-foreground">
          You&rsquo;re at your limit — a request below will lift it.
        </div>
      )}
    </div>
  );
}

function RequestStatus({ status }: { status: RequestRow["status"] }) {
  if (status === "processed") return <Badge variant="outline">Done</Badge>;
  if (status === "declined") return <Badge variant="outline">Declined</Badge>;
  return <Badge variant="outline">Waiting on us</Badge>;
}

function describeTier(t: PlanTier): string {
  const l = PLAN_LIMITS[t];
  const locs = isUnlimited(l.locations)
    ? "Unlimited locations"
    : `${l.locations} location${l.locations === 1 ? "" : "s"}`;
  const staff = isUnlimited(l.staff) ? "unlimited staff" : `${l.staff} staff accounts`;
  return `${locs}, ${staff}.`;
}

function describeRequest(r: RequestRow): string {
  if (r.requested_plan) return `Move to ${PLAN_LIMITS[r.requested_plan].label}`;
  if (r.requested_addon_locations_delta)
    return `Add ${r.requested_addon_locations_delta} extra location${r.requested_addon_locations_delta === 1 ? "" : "s"}`;
  return "Plan change";
}
