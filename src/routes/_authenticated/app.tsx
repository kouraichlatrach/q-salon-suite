import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/hooks/use-tenant";
import { PLAN_LIMITS, PLAN_FEATURES, type PlanTier } from "@/lib/plan-limits";
import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  CalendarClock,
  Users,
  Package,
  TrendingUp,
  Check,
  Sparkles,
} from "lucide-react";

export const Route = createFileRoute("/_authenticated/app")({
  head: () => ({
    meta: [{ title: "Dashboard — Q-Salon Suite" }, { name: "robots", content: "noindex" }],
  }),
  component: AppPage,
});

function AppPage() {
  const tenant = useTenant();

  if (tenant.isLoading) {
    return (
      <div className="min-h-screen bg-background p-8">
        <Skeleton className="mb-4 h-12 w-64" />
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }

  if (!tenant.data) return null;

  // Platform admins without a brand get the admin CTA via AppShell,
  // not the salon-owner onboarding wizard.
  if (!tenant.data.brandId && tenant.data.isPlatformAdmin) {
    return <AppShell>{null}</AppShell>;
  }

  if (!tenant.data.brandId) {
    return <Onboarding />;
  }

  return (
    <AppShell>
      <Dashboard />
    </AppShell>
  );
}

// ============================================================
// ONBOARDING
// ============================================================

function Onboarding() {
  const navigate = useNavigate();
  const tenant = useTenant();
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [brandName, setBrandName] = useState("");
  const [plan, setPlan] = useState<PlanTier>("starter");
  const [locName, setLocName] = useState("");
  const [locAddress, setLocAddress] = useState("");
  const [locPhone, setLocPhone] = useState("");
  const [loading, setLoading] = useState(false);

  async function finish() {
    if (!tenant.data?.userId) return;
    setLoading(true);
    try {
      const limits = PLAN_LIMITS[plan];
      const { error: rpcErr } = await supabase.rpc("create_brand_with_owner_location", {
        _brand_name: brandName.trim(),
        _plan: plan,
        _max_locations: limits.locations,
        _max_staff_accounts: limits.staff,
        _location_name: locName.trim(),
        _location_address: locAddress.trim(),
        _location_phone: locPhone.trim(),
      });
      if (rpcErr) throw rpcErr;

      toast.success("Welcome to Q-Salon!", { description: `${brandName} is set up.` });
      await tenant.refetch();
      navigate({ to: "/app" });
    } catch (err) {
      toast.error("Setup failed", {
        description: errorMessage(err, "Please try again."),
      });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto max-w-3xl px-6 py-12">
        <div className="mb-10 flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-md bg-primary text-primary-foreground font-display font-semibold">
            Q
          </div>
          <span className="font-display text-lg font-semibold">Q-Salon Suite</span>
        </div>

        <div className="mb-8">
          <div className="flex items-center gap-3">
            {[1, 2, 3].map((n) => (
              <div key={n} className="flex flex-1 items-center gap-3">
                <div
                  className={`flex h-8 w-8 items-center justify-center rounded-full text-xs font-semibold ${
                    step >= n
                      ? "bg-accent text-accent-foreground"
                      : "bg-muted text-muted-foreground"
                  }`}
                >
                  {step > n ? <Check className="h-4 w-4" /> : n}
                </div>
                {n < 3 && (
                  <div className={`h-px flex-1 ${step > n ? "bg-accent" : "bg-border"}`} />
                )}
              </div>
            ))}
          </div>
          <div className="mt-2 grid grid-cols-3 text-xs text-muted-foreground">
            <span>Your brand</span>
            <span className="text-center">Choose plan</span>
            <span className="text-right">First location</span>
          </div>
        </div>

        {step === 1 && (
          <Card>
            <CardHeader>
              <CardTitle className="font-display text-2xl">Name your salon brand</CardTitle>
              <CardDescription>
                This is the parent brand under which all your locations live.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="brand">Brand name</Label>
                <Input
                  id="brand"
                  value={brandName}
                  onChange={(e) => setBrandName(e.target.value)}
                  placeholder="e.g. Rose & Amber Salons"
                  required
                />
              </div>
              <div className="flex justify-end">
                <Button onClick={() => setStep(2)} disabled={!brandName.trim()}>
                  Continue
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {step === 2 && (
          <div className="space-y-4">
            <div>
              <h2 className="font-display text-2xl font-semibold">Choose your plan</h2>
              <p className="text-sm text-muted-foreground">
                You can change plans anytime. Billed offline via bank transfer.
              </p>
            </div>
            <div className="grid gap-4 md:grid-cols-3">
              {(Object.keys(PLAN_LIMITS) as PlanTier[]).map((p) => {
                const info = PLAN_LIMITS[p];
                const selected = plan === p;
                return (
                  <button
                    key={p}
                    type="button"
                    onClick={() => setPlan(p)}
                    className={`rounded-xl border-2 p-5 text-left transition-all ${
                      selected
                        ? "border-accent bg-accent/5 shadow-sm"
                        : "border-border bg-card hover:border-accent/40"
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-display text-lg font-semibold">{info.label}</span>
                      {selected && <Check className="h-5 w-5 text-accent" />}
                    </div>
                    <ul className="mt-4 space-y-1.5 text-sm text-muted-foreground">
                      {PLAN_FEATURES[p].map((f) => (
                        <li key={f} className="flex items-start gap-2">
                          <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0 text-accent" />
                          <span>{f}</span>
                        </li>
                      ))}
                    </ul>
                  </button>
                );
              })}
            </div>
            <div className="flex justify-between pt-2">
              <Button variant="ghost" onClick={() => setStep(1)}>
                Back
              </Button>
              <Button onClick={() => setStep(3)}>Continue</Button>
            </div>
          </div>
        )}

        {step === 3 && (
          <Card>
            <CardHeader>
              <CardTitle className="font-display text-2xl">Add your first location</CardTitle>
              <CardDescription>
                You can add more locations later from settings.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="ln">Location name</Label>
                <Input
                  id="ln"
                  value={locName}
                  onChange={(e) => setLocName(e.target.value)}
                  placeholder="e.g. Al Sadd Flagship"
                  required
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="la">Address (optional)</Label>
                <Input
                  id="la"
                  value={locAddress}
                  onChange={(e) => setLocAddress(e.target.value)}
                  placeholder="Street, area, Doha"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="lp">Phone (optional)</Label>
                <Input
                  id="lp"
                  value={locPhone}
                  onChange={(e) => setLocPhone(e.target.value)}
                  placeholder="+974 ..."
                />
              </div>
              <div className="flex justify-between pt-2">
                <Button variant="ghost" onClick={() => setStep(2)}>
                  Back
                </Button>
                <Button onClick={finish} disabled={loading || !locName.trim()}>
                  {loading ? "Setting up..." : "Finish setup"}
                </Button>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}

// ============================================================
// DASHBOARD
// ============================================================

function Dashboard() {
  const tenant = useTenant();

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
          {[
            { label: "Today's appointments", value: "—", icon: CalendarClock },
            { label: "Revenue today", value: "QAR 0", icon: TrendingUp },
            { label: "Active clients", value: "—", icon: Users },
            { label: "Low stock items", value: "—", icon: Package },
          ].map((k) => (
            <Card key={k.label}>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  {k.label}
                </CardTitle>
                <k.icon className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="font-display text-3xl font-semibold">{k.value}</div>
              </CardContent>
            </Card>
          ))}
        </div>

        <Card className="mt-8">
          <CardHeader>
            <CardTitle className="font-display text-xl">You're all set up</CardTitle>
            <CardDescription>
              Your brand and first location are live. Feature modules will appear here as we
              build them out for your account.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="rounded-lg bg-secondary p-4 text-sm text-secondary-foreground">
              <div className="font-medium">Next up</div>
              <ul className="mt-2 list-inside list-disc space-y-1 text-muted-foreground">
                <li>Add your service catalog</li>
                <li>Import your client list</li>
                <li>Set up staff accounts and schedules</li>
                <li>Configure product inventory</li>
              </ul>
            </div>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
