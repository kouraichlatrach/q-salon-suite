import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { format, parseISO } from "date-fns";
import { ArrowLeft, AlertTriangle, CalendarIcon } from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import {
  EXTRA_LOCATION_ADDON,
  PLAN_LIMITS,
  PLAN_ORDER,
  formatQar,
  type PlanTier,
} from "@/lib/plan-limits";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { cn } from "@/lib/utils";
import { StatusBadge } from "./admin";

export const Route = createFileRoute("/_authenticated/admin/brands/$id")({
  head: () => ({
    meta: [{ title: "Brand — Platform admin" }, { name: "robots", content: "noindex" }],
  }),
  component: BrandDetail,
});

type SubStatus = "trial" | "active" | "expiring" | "expired";
type Cycle = "monthly" | "yearly";

function BrandDetail() {
  const { id } = Route.useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();

  const q = useQuery({
    queryKey: ["admin-brand", id],
    queryFn: async () => {
      const { data: brand, error } = await supabase
        .from("brands")
        .select(
          "id, name, plan, subscription_status, billing_cycle, renewal_date, owner_user_id, max_staff_accounts, max_locations, addon_locations, currency, created_at",
        )
        .eq("id", id)
        .maybeSingle();
      if (error) throw error;
      if (!brand) return null;

      const [ownerRes, locRes, staffRes] = await Promise.all([
        supabase
          .from("profiles")
          .select("id, full_name, email, phone")
          .eq("id", brand.owner_user_id)
          .maybeSingle(),
        supabase
          .from("locations")
          .select("id", { count: "exact", head: true })
          .eq("brand_id", brand.id),
        supabase.from("user_roles").select("role").eq("brand_id", brand.id),
      ]);

      const staffAccounts = (staffRes.data ?? []).filter((r: any) => r.role !== "owner").length;
      return {
        brand,
        owner: ownerRes.data,
        locationCount: locRes.count ?? 0,
        staffAccounts,
      };
    },
  });

  const [plan, setPlan] = useState<PlanTier>("starter");
  const [status, setStatus] = useState<SubStatus>("trial");
  const [cycle, setCycle] = useState<Cycle>("monthly");
  const [renewalDate, setRenewalDate] = useState<Date | undefined>(undefined);
  // Held as a string so the field can be empty mid-edit without snapping to 0.
  const [addonLocations, setAddonLocations] = useState("0");

  useEffect(() => {
    if (q.data?.brand) {
      setPlan(q.data.brand.plan as PlanTier);
      setStatus(q.data.brand.subscription_status as SubStatus);
      setCycle(q.data.brand.billing_cycle as Cycle);
      setRenewalDate(q.data.brand.renewal_date ? parseISO(q.data.brand.renewal_date) : undefined);
      setAddonLocations(String(q.data.brand.addon_locations ?? 0));
    }
  }, [q.data?.brand?.id]);

  const save = useMutation({
    mutationFn: async () => {
      const limits = PLAN_LIMITS[plan];

      // Mirror the CHECK constraint so a bad value is refused here with a
      // sentence rather than as a raw Postgres error.
      const addon = Number(addonLocations);
      if (!Number.isInteger(addon) || addon < 0 || addon > 50) {
        throw new Error("Extra locations must be a whole number between 0 and 50.");
      }
      if (addon > 0 && !limits.addonEligible) {
        throw new Error(
          `${limits.label} already includes unlimited locations — extra locations cannot be added to it.`,
        );
      }

      const { error } = await supabase
        .from("brands")
        .update({
          plan,
          subscription_status: status,
          billing_cycle: cycle,
          renewal_date: renewalDate ? format(renewalDate, "yyyy-MM-dd") : null,
          max_locations: limits.locations,
          max_staff_accounts: limits.staff,
          addon_locations: addon,
        })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: async () => {
      toast.success("Brand updated");
      await qc.invalidateQueries({ queryKey: ["admin-brand", id] });
      await qc.invalidateQueries({ queryKey: ["admin-brands"] });
    },
    onError: (e: any) => toast.error(e.message ?? "Update failed"),
  });

  if (q.isLoading) return <Skeleton className="h-96 w-full" />;
  if (!q.data) {
    return (
      <div>
        <Button variant="ghost" size="sm" onClick={() => navigate({ to: "/admin" })}>
          <ArrowLeft className="h-4 w-4 mr-1" /> Back
        </Button>
        <p className="mt-4 text-sm text-slate-500">Brand not found.</p>
      </div>
    );
  }

  const { brand, owner, locationCount, staffAccounts } = q.data;
  const targetLimits = PLAN_LIMITS[plan];
  // The warning has to use the same arithmetic the trigger does, or an admin
  // is told a brand will breach its limit when the purchased add-ons cover it.
  const targetAddon = targetLimits.addonEligible ? Number(addonLocations) || 0 : 0;
  const targetLocationAllowance = targetLimits.locations + targetAddon;
  const willExceedLoc = locationCount > targetLocationAllowance;
  const willExceedStaff = staffAccounts > targetLimits.staff;

  return (
    <div className="space-y-6">
      <div>
        <Link
          to="/admin"
          className="inline-flex items-center gap-1 text-xs text-slate-500 hover:text-slate-800"
        >
          <ArrowLeft className="h-3 w-3" /> Back to brands
        </Link>
        <div className="mt-2 flex items-center gap-3">
          <h1 className="text-2xl font-semibold">{brand.name}</h1>
          <StatusBadge status={brand.subscription_status} />
        </div>
        <p className="text-sm text-slate-500">
          Created {format(parseISO(brand.created_at), "MMMM d, yyyy")}
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2 bg-white">
          <CardHeader>
            <CardTitle className="text-base">Subscription</CardTitle>
            <CardDescription>
              Manual billing controls. Writes directly to the brands table.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Plan</Label>
                <Select value={plan} onValueChange={(v) => setPlan(v as PlanTier)}>
                  <SelectTrigger className="bg-white">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PLAN_ORDER.map((p) => (
                      <SelectItem key={p} value={p}>
                        {PLAN_LIMITS[p].label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label>Subscription status</Label>
                <Select value={status} onValueChange={(v) => setStatus(v as SubStatus)}>
                  <SelectTrigger className="bg-white">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="trial">Trial</SelectItem>
                    <SelectItem value="active">Active</SelectItem>
                    <SelectItem value="expiring">Expiring</SelectItem>
                    <SelectItem value="expired">Expired</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label>Billing cycle</Label>
                <Select value={cycle} onValueChange={(v) => setCycle(v as Cycle)}>
                  <SelectTrigger className="bg-white">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="monthly">Monthly</SelectItem>
                    <SelectItem value="yearly">Yearly</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label>Renewal date</Label>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button
                      variant="outline"
                      className={cn(
                        "w-full justify-start bg-white font-normal",
                        !renewalDate && "text-slate-400",
                      )}
                    >
                      <CalendarIcon className="h-4 w-4 mr-2" />
                      {renewalDate ? format(renewalDate, "PPP") : "Pick a date"}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0 pointer-events-auto" align="start">
                    <Calendar
                      mode="single"
                      selected={renewalDate}
                      onSelect={setRenewalDate}
                      className="p-3 pointer-events-auto"
                    />
                  </PopoverContent>
                </Popover>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="addon-locations">Extra locations (add-on)</Label>
                <Input
                  id="addon-locations"
                  type="number"
                  min={0}
                  max={50}
                  step={1}
                  inputMode="numeric"
                  className="bg-white"
                  value={addonLocations}
                  disabled={!targetLimits.addonEligible}
                  onChange={(e) => setAddonLocations(e.target.value)}
                />
                <p className="text-xs text-slate-500">
                  {targetLimits.addonEligible ? (
                    <>
                      Billed at {formatQar(EXTRA_LOCATION_ADDON.priceMonthly)}/mo each, on top of{" "}
                      {PLAN_LIMITS[plan].label}. Allowed total:{" "}
                      <span className="font-medium text-slate-700">
                        {targetLimits.locations + (Number(addonLocations) || 0)}
                      </span>{" "}
                      ({targetLimits.locations} included + {Number(addonLocations) || 0} purchased).
                    </>
                  ) : (
                    <>{PLAN_LIMITS[plan].label} already includes unlimited locations.</>
                  )}
                </p>
              </div>
            </div>

            {(willExceedLoc || willExceedStaff) && (
              <div className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
                <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
                <div>
                  <div className="font-medium">Plan limits will be exceeded</div>
                  <ul className="mt-1 list-disc pl-5 text-xs">
                    {willExceedLoc && (
                      <li>
                        Brand has {locationCount} locations; {PLAN_LIMITS[plan].label} allows{" "}
                        {targetLocationAllowance}
                        {targetAddon > 0 &&
                          ` (${targetLimits.locations} + ${targetAddon} purchased)`}
                        .
                      </li>
                    )}
                    {willExceedStaff && (
                      <li>
                        Brand has {staffAccounts} staff accounts; {PLAN_LIMITS[plan].label} allows{" "}
                        {targetLimits.staff}.
                      </li>
                    )}
                  </ul>
                </div>
              </div>
            )}

            <div className="flex justify-end pt-2">
              <Button onClick={() => save.mutate()} disabled={save.isPending}>
                {save.isPending ? "Saving…" : "Save changes"}
              </Button>
            </div>
          </CardContent>
        </Card>

        <div className="space-y-6">
          <Card className="bg-white">
            <CardHeader>
              <CardTitle className="text-base">Owner</CardTitle>
            </CardHeader>
            <CardContent className="text-sm space-y-1">
              <div className="font-medium">{owner?.full_name ?? "—"}</div>
              <div className="text-slate-500">{owner?.email ?? "—"}</div>
              {owner?.phone && <div className="text-slate-500">{owner.phone}</div>}
            </CardContent>
          </Card>

          <Card className="bg-white">
            <CardHeader>
              <CardTitle className="text-base">Usage vs. plan</CardTitle>
              <CardDescription>Current {brand.plan} limits.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              {/* Saved state, not the pending form state: this is what the
                  database will actually enforce right now. */}
              <UsageRow
                label="Locations"
                used={locationCount}
                max={brand.max_locations + (brand.addon_locations ?? 0)}
              />
              <UsageRow
                label="Staff accounts"
                used={staffAccounts}
                max={brand.max_staff_accounts}
              />
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

function UsageRow({ label, used, max }: { label: string; used: number; max: number }) {
  const over = used > max;
  const pct = Math.min(100, max > 0 ? (used / max) * 100 : 0);
  return (
    <div>
      <div className="flex justify-between mb-1">
        <span>{label}</span>
        <span className={cn("font-medium", over && "text-red-700")}>
          {used} / {max}
        </span>
      </div>
      <div className="h-1.5 w-full rounded bg-slate-100 overflow-hidden">
        <div
          className={cn("h-full", over ? "bg-red-500" : "bg-slate-700")}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}
