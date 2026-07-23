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
        .select("id, name, plan, subscription_status, renewal_date, billing_cycle")
        .eq("id", brandId)
        .single();
      if (error) throw error;
      return data;
    },
  });

  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (brand) setName(brand.name);
  }, [brand]);

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
