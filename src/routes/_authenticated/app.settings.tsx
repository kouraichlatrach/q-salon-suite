import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { format } from "date-fns";

import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/hooks/use-tenant";
import { AppShell } from "@/components/app-shell";
import { errorMessage } from "@/lib/error-message";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { PLAN_LIMITS, type PlanTier } from "@/lib/plan-limits";

export const Route = createFileRoute("/_authenticated/app/settings")({
  head: () => ({
    meta: [{ title: "Settings — Q-Salon Suite" }, { name: "robots", content: "noindex" }],
  }),
  component: SettingsPage,
});

function SettingsPage() {
  const tenant = useTenant();

  if (tenant.isLoading) {
    return (
      <AppShell>
        <div className="p-8">
          <Skeleton className="mb-4 h-10 w-64" />
          <Skeleton className="h-96 w-full" />
        </div>
      </AppShell>
    );
  }

  if (tenant.data?.primaryRole !== "owner") {
    return (
      <AppShell>
        <div className="p-8">
          <h1 className="font-display text-2xl font-semibold">Not available</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Only the salon owner can manage settings.
          </p>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <SettingsContent />
    </AppShell>
  );
}

function SettingsContent() {
  const tenant = useTenant();
  const brandId = tenant.data!.brandId!;
  const queryClient = useQueryClient();

  const { data: brand, isLoading } = useQuery({
    queryKey: ["brand-settings", brandId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("brands")
        .select("id, name, plan, subscription_status, renewal_date, billing_cycle, min_notice_hours, max_advance_days, deposit_hold_minutes, refund_cutoff_hours, reminder_lead_hours, whatsapp_enabled")
        .eq("id", brandId)
        .single();
      if (error) throw error;
      return data;
    },
  });

  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);

  // Booking-window and messaging settings. All four of the first group already
  // existed in the database and were enforced server-side, but had no UI at
  // all — an Owner could not see or change them.
  const [minNotice, setMinNotice] = useState("3");
  const [maxAdvance, setMaxAdvance] = useState("30");
  const [holdMinutes, setHoldMinutes] = useState("15");
  const [refundCutoff, setRefundCutoff] = useState("24");
  const [reminderLead, setReminderLead] = useState("24");
  const [waEnabled, setWaEnabled] = useState(true);
  const [savingOps, setSavingOps] = useState(false);

  useEffect(() => {
    if (!brand) return;
    setName(brand.name);
    setMinNotice(String(brand.min_notice_hours ?? 3));
    setMaxAdvance(String(brand.max_advance_days ?? 30));
    setHoldMinutes(String(brand.deposit_hold_minutes ?? 15));
    setRefundCutoff(String(brand.refund_cutoff_hours ?? 24));
    setReminderLead(String(brand.reminder_lead_hours ?? 24));
    setWaEnabled(brand.whatsapp_enabled ?? true);
  }, [brand]);

  async function saveOps() {
    // Mirror the database CHECK constraints so a bad value is rejected here
    // with a useful message rather than as a raw Postgres error.
    const rules: Array<[string, number, number, number]> = [
      ["Minimum notice", Number(minNotice), 0, 720],
      ["Maximum advance", Number(maxAdvance), 1, 365],
      ["Deposit hold", Number(holdMinutes), 1, 1440],
      ["Refund cutoff", Number(refundCutoff), 0, 720],
      ["Reminder lead time", Number(reminderLead), 1, 168],
    ];
    for (const [label, value, lo, hi] of rules) {
      if (!Number.isFinite(value) || !Number.isInteger(value) || value < lo || value > hi) {
        toast.error(`${label} must be a whole number between ${lo} and ${hi}.`);
        return;
      }
    }
    setSavingOps(true);
    try {
      const { error } = await supabase
        .from("brands")
        .update({
          min_notice_hours: Number(minNotice),
          max_advance_days: Number(maxAdvance),
          deposit_hold_minutes: Number(holdMinutes),
          refund_cutoff_hours: Number(refundCutoff),
          reminder_lead_hours: Number(reminderLead),
          whatsapp_enabled: waEnabled,
        })
        .eq("id", brandId);
      if (error) throw error;
      toast.success("Booking settings saved");
      queryClient.invalidateQueries({ queryKey: ["brand-settings", brandId] });
    } catch (err) {
      toast.error("Could not save", { description: errorMessage(err, "Please try again.") });
    } finally {
      setSavingOps(false);
    }
  }

  async function save() {
    const trimmed = name.trim();
    if (!trimmed) {
      toast.error("Brand name is required.");
      return;
    }
    setSaving(true);
    try {
      const { error } = await supabase
        .from("brands")
        .update({ name: trimmed })
        .eq("id", brandId);
      if (error) throw error;
      toast.success("Settings saved");
      queryClient.invalidateQueries({ queryKey: ["brand-settings", brandId] });
      queryClient.invalidateQueries({ queryKey: ["brand", brandId] });
      queryClient.invalidateQueries({ queryKey: ["tenant-context"] });
    } catch (err) {
      toast.error("Could not save", {
        description: errorMessage(err, "Please try again."),
      });
    } finally {
      setSaving(false);
    }
  }

  const planLabel = brand ? PLAN_LIMITS[brand.plan as PlanTier]?.label ?? brand.plan : "";

  return (
    <div className="mx-auto max-w-3xl px-6 py-10">
      <div className="mb-8">
        <h1 className="font-display text-3xl font-semibold tracking-tight">Settings</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Manage your brand and view your current subscription.
        </p>
      </div>

      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="font-display">Brand</CardTitle>
          <CardDescription>The name shown across your Q-Salon workspace.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {isLoading ? (
            <Skeleton className="h-10 w-full" />
          ) : (
            <div>
              <Label htmlFor="brand-name">Brand name</Label>
              <Input
                id="brand-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                dir="auto"
              />
            </div>
          )}
          <div className="flex justify-end">
            <Button onClick={save} disabled={saving || isLoading}>
              {saving ? "Saving…" : "Save"}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="font-display">Booking &amp; messaging</CardTitle>
          <CardDescription>
            Controls the public booking window, deposit handling, and WhatsApp reminders.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {isLoading ? (
            <Skeleton className="h-40 w-full" />
          ) : (
            <>
              <div className="grid gap-4 sm:grid-cols-2">
                <NumberSetting
                  id="set-min-notice" label="Minimum notice (hours)"
                  hint="How soon before a slot clients can still book it."
                  value={minNotice} onChange={setMinNotice}
                />
                <NumberSetting
                  id="set-max-advance" label="Maximum advance (days)"
                  hint="How far ahead the booking calendar goes."
                  value={maxAdvance} onChange={setMaxAdvance}
                />
                <NumberSetting
                  id="set-hold" label="Deposit hold (minutes)"
                  hint="How long a slot is held while a deposit is unpaid."
                  value={holdMinutes} onChange={setHoldMinutes}
                />
                <NumberSetting
                  id="set-refund" label="Refund cutoff (hours)"
                  hint="Cancel earlier than this for a full deposit refund."
                  value={refundCutoff} onChange={setRefundCutoff}
                />
                <NumberSetting
                  id="set-reminder" label="Reminder lead time (hours)"
                  hint="How long before the appointment the WhatsApp reminder is sent."
                  value={reminderLead} onChange={setReminderLead}
                />
              </div>

              <label
                htmlFor="set-wa-enabled"
                className="flex cursor-pointer items-start gap-3 rounded-md border border-border p-3"
              >
                <Checkbox
                  id="set-wa-enabled"
                  checked={waEnabled}
                  onCheckedChange={(v) => setWaEnabled(v === true)}
                  className="mt-0.5"
                />
                <span className="text-sm">
                  <span className="font-medium">Send WhatsApp updates</span>
                  <span className="mt-0.5 block text-xs text-muted-foreground">
                    Master switch. Turning this off stops all confirmations and reminders
                    for this brand, without changing any client's own consent.
                  </span>
                </span>
              </label>
            </>
          )}
          <div className="flex justify-end">
            <Button onClick={saveOps} disabled={savingOps || isLoading}>
              {savingOps ? "Saving…" : "Save"}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="font-display">Subscription</CardTitle>
          <CardDescription>
            Managed by Q-Salon. Contact support to change your plan or renewal.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {isLoading || !brand ? (
            <Skeleton className="h-24 w-full" />
          ) : (
            <dl className="grid gap-4 sm:grid-cols-3">
              <div>
                <dt className="text-xs uppercase tracking-wider text-muted-foreground">Plan</dt>
                <dd className="mt-1 text-lg font-medium">{planLabel}</dd>
              </div>
              <div>
                <dt className="text-xs uppercase tracking-wider text-muted-foreground">Status</dt>
                <dd className="mt-1">
                  <Badge
                    variant="outline"
                    className={
                      brand.subscription_status === "active"
                        ? "border-emerald-400 bg-emerald-50 text-emerald-900"
                        : brand.subscription_status === "trial"
                          ? "border-amber-400 bg-amber-50 text-amber-900"
                          : "border-destructive/40 bg-destructive/10 text-destructive"
                    }
                  >
                    <span className="capitalize">{brand.subscription_status}</span>
                  </Badge>
                </dd>
              </div>
              <div>
                <dt className="text-xs uppercase tracking-wider text-muted-foreground">
                  Renewal date
                </dt>
                <dd className="mt-1 text-lg font-medium">
                  {brand.renewal_date
                    ? format(new Date(brand.renewal_date), "MMM d, yyyy")
                    : "—"}
                </dd>
              </div>
            </dl>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

/** Small labelled numeric field, shared by the booking settings grid. */
function NumberSetting({
  id, label, hint, value, onChange,
}: {
  id: string; label: string; hint: string; value: string; onChange: (v: string) => void;
}) {
  return (
    <div>
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        type="number"
        inputMode="numeric"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
      <p className="mt-1 text-xs text-muted-foreground">{hint}</p>
    </div>
  );
}
