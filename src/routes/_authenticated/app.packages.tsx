import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { addMonths, format, parseISO } from "date-fns";
import { Boxes, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/hooks/use-tenant";
import { AppShell } from "@/components/app-shell";
import { errorMessage } from "@/lib/error-message";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export const Route = createFileRoute("/_authenticated/app/packages")({
  head: () => ({
    meta: [{ title: "Packages — Q-Salon Suite" }, { name: "robots", content: "noindex" }],
  }),
  component: PackagesPage,
});

type PayMethod = "cash" | "card" | "bank_transfer";

type BalanceRow = { service_id: string; remaining_count: number; included_count: number };

type SoldRow = {
  id: string;
  client_id: string;
  price_paid: number;
  currency: string;
  purchased_at: string;
  expires_at: string | null;
  status: string;
  clients: { name: string } | null;
  package_types: { name: string } | null;
  client_package_service_balances: BalanceRow[];
};

type ExpiredRow = {
  client_package_id: string;
  package_name: string;
  client_name: string | null;
  location_name: string | null;
  expires_at: string;
  price_paid: number;
  currency: string;
  total_remaining: number;
  total_included: number;
};

type LineDraft = { service_id: string; included_count: string };

/**
 * Derived here exactly as the database derives it, rather than trusting the
 * stored `status` column — a package that lapsed since it was sold would
 * otherwise still read as "Active" until something wrote to it. Same rule as
 * the gift card screen.
 */
function effectiveStatus(p: {
  status: string;
  expires_at: string | null;
  client_package_service_balances: BalanceRow[];
}) {
  if (p.status === "refunded") return "refunded";
  if (p.expires_at && new Date(p.expires_at) <= new Date()) return "expired";
  const remaining = p.client_package_service_balances.reduce((s, b) => s + b.remaining_count, 0);
  if (remaining <= 0) return "used";
  return "active";
}

function StatusBadge({ status }: { status: string }) {
  if (status === "active") return <Badge variant="secondary">Active</Badge>;
  if (status === "used") return <Badge variant="outline">Fully used</Badge>;
  if (status === "refunded") return <Badge variant="outline">Refunded</Badge>;
  return (
    <Badge className="border-transparent bg-amber-100 text-amber-900 hover:bg-amber-100">
      Expired
    </Badge>
  );
}

function PackagesPage() {
  const tenant = useTenant();
  const qc = useQueryClient();
  const brandId = tenant.data?.brandId ?? null;
  const role = tenant.data?.primaryRole;
  const canSell = role === "owner" || role === "manager" || role === "receptionist";
  const isOwner = role === "owner";
  // Refunds and goodwill extensions are an Owner/Manager decision, matching the
  // check inside package_refund — a receptionist can sell, but not reverse.
  const canAdjust = role === "owner" || role === "manager";

  const brandQuery = useQuery({
    enabled: !!brandId,
    queryKey: ["pkg-brand", brandId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("brands")
        .select("id, currency")
        .eq("id", brandId!)
        .single();
      if (error) throw error;
      return data;
    },
  });

  const locationsQuery = useQuery({
    enabled: !!brandId,
    queryKey: ["pkg-locations", brandId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("locations")
        .select("id, name")
        .eq("brand_id", brandId!)
        .order("name");
      if (error) throw error;
      return data ?? [];
    },
  });

  const servicesQuery = useQuery({
    enabled: !!brandId,
    queryKey: ["pkg-services", brandId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("services")
        .select("id, name, default_price")
        .eq("brand_id", brandId!)
        .eq("is_active", true)
        .order("name");
      if (error) throw error;
      return data ?? [];
    },
  });

  const clientsQuery = useQuery({
    enabled: !!brandId,
    queryKey: ["pkg-clients", brandId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("clients")
        .select("id, name, phone")
        .eq("brand_id", brandId!)
        .order("name")
        .limit(500);
      if (error) throw error;
      return data ?? [];
    },
  });

  const typesQuery = useQuery({
    enabled: !!brandId,
    queryKey: ["package-types", brandId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("package_types")
        .select(
          "id, name, description, price, currency, expiry_months, status, package_services(id, service_id, included_count)",
        )
        .eq("brand_id", brandId!)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  const soldQuery = useQuery({
    enabled: !!brandId,
    queryKey: ["client-packages", brandId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("client_packages")
        .select(
          "id, client_id, price_paid, currency, purchased_at, expires_at, status, clients(name), package_types(name), client_package_service_balances(service_id, remaining_count, included_count)",
        )
        .eq("brand_id", brandId!)
        .order("purchased_at", { ascending: false })
        .limit(200);
      if (error) throw error;
      return (data ?? []) as unknown as SoldRow[];
    },
  });

  // Redemption counts decide whether a refund is still allowed. The database
  // enforces this too — this only keeps the UI from offering an action that
  // would be refused.
  const redemptionsQuery = useQuery({
    enabled: !!brandId,
    queryKey: ["package-redemptions", brandId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("package_redemptions")
        .select("client_package_id")
        .eq("brand_id", brandId!)
        .limit(2000);
      if (error) throw error;
      const counts = new Map<string, number>();
      for (const r of data ?? []) {
        counts.set(r.client_package_id, (counts.get(r.client_package_id) ?? 0) + 1);
      }
      return counts;
    },
  });

  const expiredQuery = useQuery({
    enabled: !!brandId,
    queryKey: ["packages-expired", brandId],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("packages_expired_with_balance", {
        _brand_id: brandId!,
      });
      if (error) throw error;
      return (data ?? []) as ExpiredRow[];
    },
  });

  const currency = brandQuery.data?.currency ?? "QAR";
  // Memoised so the fallback [] doesn't get a new identity every render and
  // invalidate the lookup map below on each pass.
  const services = useMemo(() => servicesQuery.data ?? [], [servicesQuery.data]);
  const serviceName = useMemo(() => {
    const m = new Map<string, string>();
    for (const s of services) m.set(s.id, s.name);
    return m;
  }, [services]);

  // ---- Sale form -----------------------------------------------------------
  const [clientId, setClientId] = useState("");
  const [typeId, setTypeId] = useState("");
  const [locationId, setLocationId] = useState("");
  const [method, setMethod] = useState<PayMethod>("cash");
  const [note, setNote] = useState("");

  useEffect(() => {
    if (locationId) return;
    const own = tenant.data?.locationId;
    if (own) setLocationId(own);
    else if (locationsQuery.data?.length) setLocationId(locationsQuery.data[0].id);
  }, [tenant.data?.locationId, locationsQuery.data, locationId]);

  const selectedType = (typesQuery.data ?? []).find((t) => t.id === typeId);

  const sell = useMutation({
    mutationFn: async () => {
      if (!clientId) throw new Error("Choose which client is buying.");
      if (!typeId) throw new Error("Choose a package.");
      if (!locationId) throw new Error("Choose which location is selling this package.");

      const { data, error } = await supabase.rpc("package_sell", {
        _brand_id: brandId!,
        _location_id: locationId,
        _client_id: clientId,
        _package_type_id: typeId,
        _method: method,
        _note: note.trim() || undefined,
      });
      if (error) throw error;

      const row = Array.isArray(data) ? data[0] : data;
      // Business failures come back as a row, not an exception, so a permission
      // or validation problem reads as a clear message rather than raw Postgres.
      if (!row || row.error) {
        const map: Record<string, string> = {
          forbidden: "You don't have permission to sell at this location.",
          unknown_package: "That package no longer exists.",
          package_inactive: "That package is no longer offered for sale.",
          unknown_client: "That client no longer exists.",
          package_empty: "That package has no services in it yet — add at least one first.",
        };
        throw new Error(map[row?.error ?? ""] ?? row?.error ?? "Could not sell the package.");
      }
      return row as { client_package_id: string; expires_at: string | null };
    },
    onSuccess: (res) => {
      toast.success("Package sold", {
        description: res.expires_at
          ? `Expires ${format(parseISO(res.expires_at), "d MMM yyyy")}.`
          : "No expiry.",
      });
      setNote("");
      qc.invalidateQueries({ queryKey: ["client-packages", brandId] });
      qc.invalidateQueries({ queryKey: ["packages-expired", brandId] });
    },
    onError: (e) =>
      toast.error("Could not sell", { description: errorMessage(e, "Please try again.") }),
  });

  // ---- Catalogue -----------------------------------------------------------
  const [defOpen, setDefOpen] = useState(false);
  const [defName, setDefName] = useState("");
  const [defDesc, setDefDesc] = useState("");
  const [defPrice, setDefPrice] = useState("");
  const [defExpiry, setDefExpiry] = useState("");
  const [defLines, setDefLines] = useState<LineDraft[]>([{ service_id: "", included_count: "1" }]);

  function resetDef() {
    setDefName("");
    setDefDesc("");
    setDefPrice("");
    setDefExpiry("");
    setDefLines([{ service_id: "", included_count: "1" }]);
  }

  const createType = useMutation({
    mutationFn: async () => {
      const price = Number(defPrice);
      if (!defName.trim()) throw new Error("Give the package a name.");
      if (!Number.isFinite(price) || price <= 0) throw new Error("Enter a price greater than 0.");

      const lines = defLines
        .filter((l) => l.service_id)
        .map((l) => ({ service_id: l.service_id, included_count: Number(l.included_count) }));
      if (lines.length === 0) throw new Error("Add at least one service to the package.");
      for (const l of lines) {
        if (!Number.isInteger(l.included_count) || l.included_count <= 0) {
          throw new Error("Every service needs a whole count greater than 0.");
        }
      }
      const ids = new Set(lines.map((l) => l.service_id));
      if (ids.size !== lines.length) {
        throw new Error("Each service can only be listed once — set its count instead.");
      }

      let months: number | null = null;
      if (defExpiry.trim()) {
        months = Number(defExpiry);
        if (!Number.isInteger(months) || months < 1 || months > 120) {
          throw new Error("Expiry must be a whole number of months between 1 and 120.");
        }
      }

      const { data: t, error: tErr } = await supabase
        .from("package_types")
        .insert({
          brand_id: brandId!,
          name: defName.trim(),
          description: defDesc.trim() || null,
          price,
          currency,
          expiry_months: months,
        })
        .select("id")
        .single();
      if (tErr) throw tErr;

      const { error: lErr } = await supabase
        .from("package_services")
        .insert(lines.map((l) => ({ package_type_id: t.id, ...l })));
      if (lErr) throw lErr;

      return t.id as string;
    },
    onSuccess: () => {
      toast.success("Package created");
      setDefOpen(false);
      resetDef();
      qc.invalidateQueries({ queryKey: ["package-types", brandId] });
    },
    onError: (e) =>
      toast.error("Could not create", { description: errorMessage(e, "Please try again.") }),
  });

  const toggleType = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) => {
      const next = status === "active" ? "inactive" : "active";
      const { error } = await supabase.from("package_types").update({ status: next }).eq("id", id);
      if (error) throw error;
      return next;
    },
    onSuccess: (next) => {
      toast.success(
        next === "active" ? "Package is on sale again" : "Package withdrawn from sale",
        {
          description:
            next === "inactive" ? "Packages already sold stay valid and redeemable." : undefined,
        },
      );
      qc.invalidateQueries({ queryKey: ["package-types", brandId] });
    },
    onError: (e) => toast.error(errorMessage(e, "Could not update")),
  });

  // ---- Refund / extend -----------------------------------------------------
  const [extendFor, setExtendFor] = useState<SoldRow | null>(null);
  const [extendDate, setExtendDate] = useState("");

  const refund = useMutation({
    mutationFn: async (id: string) => {
      const { data, error } = await supabase.rpc("package_refund", { _client_package_id: id });
      if (error) throw error;
      const row = Array.isArray(data) ? data[0] : data;
      if (!row || row.error) {
        const map: Record<string, string> = {
          forbidden: "Only an Owner or Manager can refund a package.",
          package_not_found: "That package no longer exists.",
          already_refunded: "That package was already refunded.",
          package_partially_used:
            "Sessions have already been used, so this can't be refunded. Extend the expiry date instead.",
        };
        throw new Error(map[row?.error ?? ""] ?? row?.error ?? "Could not refund.");
      }
      return row as { refunded_amount: number };
    },
    onSuccess: (res) => {
      toast.success("Package refunded", {
        description: `${Number(res.refunded_amount).toFixed(2)} ${currency} reversed against income.`,
      });
      qc.invalidateQueries({ queryKey: ["client-packages", brandId] });
      qc.invalidateQueries({ queryKey: ["packages-expired", brandId] });
    },
    onError: (e) =>
      toast.error("Could not refund", { description: errorMessage(e, "Please try again.") }),
  });

  const extend = useMutation({
    mutationFn: async () => {
      if (!extendFor) throw new Error("Nothing selected.");
      if (!extendDate) throw new Error("Pick a new expiry date.");
      // End of the chosen day, so "extend to the 30th" includes the 30th.
      const iso = new Date(`${extendDate}T23:59:59`).toISOString();
      const { data, error } = await supabase.rpc("package_extend_expiry", {
        _client_package_id: extendFor.id,
        _new_expires_at: iso,
      });
      if (error) throw error;
      const row = Array.isArray(data) ? data[0] : data;
      if (!row || row.error) {
        const map: Record<string, string> = {
          forbidden: "Only an Owner or Manager can extend a package.",
          package_not_found: "That package no longer exists.",
          already_refunded: "That package was refunded and can't be extended.",
          date_in_past: "Pick a date in the future.",
          invalid_date: "Pick a valid date.",
        };
        throw new Error(map[row?.error ?? ""] ?? row?.error ?? "Could not extend.");
      }
      return row as { expires_at: string };
    },
    onSuccess: (res) => {
      toast.success("Expiry extended", {
        description: `Now valid until ${format(parseISO(res.expires_at), "d MMM yyyy")}.`,
      });
      setExtendFor(null);
      setExtendDate("");
      qc.invalidateQueries({ queryKey: ["client-packages", brandId] });
      qc.invalidateQueries({ queryKey: ["packages-expired", brandId] });
    },
    onError: (e) =>
      toast.error("Could not extend", { description: errorMessage(e, "Please try again.") }),
  });

  if (tenant.isLoading) {
    return (
      <AppShell>
        <div className="p-8">
          <Skeleton className="h-10 w-64 mb-4" />
          <Skeleton className="h-40 w-full" />
        </div>
      </AppShell>
    );
  }

  if (!canSell) {
    return (
      <AppShell>
        <div className="p-8">
          <h1 className="font-display text-2xl font-semibold">Packages</h1>
          <p className="mt-2 text-sm text-muted-foreground">You don't have access to packages.</p>
        </div>
      </AppShell>
    );
  }

  const types = typesQuery.data ?? [];
  const sellable = types.filter((t) => t.status === "active");
  const sold = soldQuery.data ?? [];
  const expired = expiredQuery.data ?? [];
  const counts = redemptionsQuery.data ?? new Map<string, number>();

  const outstanding = sold.filter((p) => effectiveStatus(p) === "active").length;

  return (
    <AppShell>
      <div className="p-6 md:p-10 max-w-6xl">
        <div className="mb-8">
          <h1 className="font-display text-3xl font-semibold tracking-tight">Packages</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Sell prepaid service bundles and track what each client has left. Sessions are redeemed
            at checkout on the appointment itself.
          </p>
        </div>

        <div className="grid gap-6 lg:grid-cols-3">
          <Card className="lg:col-span-1">
            <CardHeader>
              <CardTitle className="font-display text-lg flex items-center gap-2">
                <Boxes className="h-4 w-4" /> Sell a package
              </CardTitle>
              <CardDescription>
                Money is logged as income straight away, the same as any other sale.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <Label htmlFor="pk-client">Client</Label>
                <Select value={clientId} onValueChange={setClientId}>
                  <SelectTrigger id="pk-client">
                    <SelectValue placeholder="Choose client" />
                  </SelectTrigger>
                  <SelectContent>
                    {(clientsQuery.data ?? []).map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.name}
                        {c.phone ? ` · ${c.phone}` : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div>
                <Label htmlFor="pk-type">Package</Label>
                <Select value={typeId} onValueChange={setTypeId}>
                  <SelectTrigger id="pk-type">
                    <SelectValue placeholder="Choose package" />
                  </SelectTrigger>
                  <SelectContent>
                    {sellable.map((t) => (
                      <SelectItem key={t.id} value={t.id}>
                        {t.name} · {Number(t.price).toFixed(2)} {currency}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {sellable.length === 0 && (
                  <p className="mt-1 text-xs text-muted-foreground">
                    No packages on sale yet{isOwner ? " — create one first." : "."}
                  </p>
                )}
              </div>

              {selectedType && (
                <div className="rounded-md border border-border bg-muted/40 p-3 text-xs">
                  <p className="font-medium text-foreground">Includes</p>
                  <ul className="mt-1 space-y-0.5 text-muted-foreground">
                    {(selectedType.package_services ?? []).map((l) => (
                      <li key={l.id}>
                        {l.included_count} × {serviceName.get(l.service_id) ?? "service"}
                      </li>
                    ))}
                  </ul>
                  <p className="mt-1.5 text-muted-foreground">
                    {selectedType.expiry_months
                      ? `Expires ${selectedType.expiry_months} month${selectedType.expiry_months === 1 ? "" : "s"} after purchase (${format(addMonths(new Date(), selectedType.expiry_months), "d MMM yyyy")}).`
                      : "No expiry."}
                  </p>
                </div>
              )}

              <div>
                <Label htmlFor="pk-location">Location</Label>
                <Select value={locationId} onValueChange={setLocationId}>
                  <SelectTrigger id="pk-location">
                    <SelectValue placeholder="Choose location" />
                  </SelectTrigger>
                  <SelectContent>
                    {(locationsQuery.data ?? []).map((l) => (
                      <SelectItem key={l.id} value={l.id}>
                        {l.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div>
                <Label htmlFor="pk-method">Payment</Label>
                <Select value={method} onValueChange={(v) => setMethod(v as PayMethod)}>
                  <SelectTrigger id="pk-method">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="cash">Cash</SelectItem>
                    <SelectItem value="card">Card</SelectItem>
                    <SelectItem value="bank_transfer">Bank transfer</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div>
                <Label htmlFor="pk-note">Note (optional)</Label>
                <Input
                  id="pk-note"
                  dir="auto"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="e.g. bridal party booking"
                />
              </div>

              <Button
                className="w-full"
                onClick={() => sell.mutate()}
                disabled={sell.isPending || !brandId}
              >
                <Plus className="mr-1.5 h-4 w-4" />
                {sell.isPending ? "Selling…" : "Sell package"}
              </Button>
            </CardContent>
          </Card>

          <div className="lg:col-span-2 space-y-6">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="font-display text-lg">Active packages</CardTitle>
                <CardDescription>
                  Sold and not yet used up — service the salon has been paid for but still owes.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <p className="font-display text-3xl font-semibold">{outstanding}</p>
              </CardContent>
            </Card>

            {isOwner && (
              <Card>
                <CardHeader className="flex-row items-start justify-between space-y-0 pb-3">
                  <div>
                    <CardTitle className="font-display text-lg">Package catalogue</CardTitle>
                    <CardDescription>
                      What's on offer. Withdrawing one stops new sales without touching packages
                      already sold.
                    </CardDescription>
                  </div>
                  <Button size="sm" variant="outline" onClick={() => setDefOpen(true)}>
                    <Plus className="mr-1 h-3.5 w-3.5" /> New
                  </Button>
                </CardHeader>
                <CardContent>
                  {typesQuery.isLoading ? (
                    <Skeleton className="h-24 w-full" />
                  ) : types.length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                      No packages defined yet. Create one to start selling.
                    </p>
                  ) : (
                    <div className="space-y-3">
                      {types.map((t) => (
                        <div
                          key={t.id}
                          className="flex items-start justify-between gap-3 rounded-md border border-border p-3"
                        >
                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              <p className="font-medium">{t.name}</p>
                              {t.status === "inactive" && (
                                <Badge variant="outline">Withdrawn</Badge>
                              )}
                            </div>
                            {t.description && (
                              <p className="mt-0.5 text-xs text-muted-foreground">
                                {t.description}
                              </p>
                            )}
                            <p className="mt-1 text-xs text-muted-foreground">
                              {(t.package_services ?? [])
                                .map(
                                  (l) =>
                                    `${l.included_count} × ${serviceName.get(l.service_id) ?? "service"}`,
                                )
                                .join(" · ") || "No services yet"}
                            </p>
                            <p className="mt-1 text-xs text-muted-foreground">
                              {Number(t.price).toFixed(2)} {currency} ·{" "}
                              {t.expiry_months ? `${t.expiry_months} month expiry` : "no expiry"}
                            </p>
                          </div>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => toggleType.mutate({ id: t.id, status: t.status })}
                            disabled={toggleType.isPending}
                          >
                            {t.status === "active" ? "Withdraw" : "Re-list"}
                          </Button>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            )}

            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="font-display text-lg">Sold packages</CardTitle>
              </CardHeader>
              <CardContent>
                {soldQuery.isLoading ? (
                  <Skeleton className="h-32 w-full" />
                ) : sold.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No packages sold yet.</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-border text-left text-xs text-muted-foreground">
                          <th className="pb-2 pr-3 font-medium">Client</th>
                          <th className="pb-2 pr-3 font-medium">Package</th>
                          <th className="pb-2 pr-3 font-medium">Sessions left</th>
                          <th className="pb-2 pr-3 font-medium">Expires</th>
                          <th className="pb-2 pr-3 font-medium">Status</th>
                          <th className="pb-2 font-medium"></th>
                        </tr>
                      </thead>
                      <tbody>
                        {sold.map((p) => {
                          const st = effectiveStatus(p);
                          const used = counts.get(p.id) ?? 0;
                          const left = p.client_package_service_balances.reduce(
                            (s, b) => s + b.remaining_count,
                            0,
                          );
                          const total = p.client_package_service_balances.reduce(
                            (s, b) => s + b.included_count,
                            0,
                          );
                          return (
                            <tr key={p.id} className="border-b border-border/50 align-top">
                              <td className="py-2 pr-3">{p.clients?.name ?? "—"}</td>
                              <td className="py-2 pr-3">{p.package_types?.name ?? "—"}</td>
                              <td className="py-2 pr-3">
                                <span className="font-medium">
                                  {left} of {total}
                                </span>
                                <div className="text-xs text-muted-foreground">
                                  {p.client_package_service_balances
                                    .map(
                                      (b) =>
                                        `${serviceName.get(b.service_id) ?? "service"} ${b.remaining_count}/${b.included_count}`,
                                    )
                                    .join(" · ")}
                                </div>
                              </td>
                              <td className="py-2 pr-3 text-muted-foreground">
                                {p.expires_at ? format(parseISO(p.expires_at), "d MMM yyyy") : "—"}
                              </td>
                              <td className="py-2 pr-3">
                                <StatusBadge status={st} />
                              </td>
                              <td className="py-2">
                                {canAdjust && st !== "refunded" && (
                                  <div className="flex gap-1">
                                    {/* Section 11 item 5: refundable only while
                                        nothing has been used. Once a session is
                                        gone, the goodwill path is extending the
                                        expiry instead. */}
                                    {used === 0 ? (
                                      <Button
                                        size="sm"
                                        variant="ghost"
                                        onClick={() => refund.mutate(p.id)}
                                        disabled={refund.isPending}
                                      >
                                        Refund
                                      </Button>
                                    ) : (
                                      <Button
                                        size="sm"
                                        variant="ghost"
                                        onClick={() => {
                                          setExtendFor(p);
                                          setExtendDate("");
                                        }}
                                      >
                                        Extend
                                      </Button>
                                    )}
                                  </div>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Section 11 item 3 is explicit that nothing happens to these
                automatically — this list exists so the Owner can decide case
                by case. Same pattern as the gift card report. */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="font-display text-lg">Expired with sessions left</CardTitle>
                <CardDescription>
                  Nothing happens to these automatically. Listed so you can decide case by case
                  whether to honour or extend them.
                </CardDescription>
              </CardHeader>
              <CardContent>
                {expiredQuery.isLoading ? (
                  <Skeleton className="h-20 w-full" />
                ) : expired.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    No expired packages with sessions remaining.
                  </p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-border text-left text-xs text-muted-foreground">
                          <th className="pb-2 pr-3 font-medium">Client</th>
                          <th className="pb-2 pr-3 font-medium">Package</th>
                          <th className="pb-2 pr-3 font-medium">Unused</th>
                          <th className="pb-2 font-medium">Expired</th>
                        </tr>
                      </thead>
                      <tbody>
                        {expired.map((e) => (
                          <tr key={e.client_package_id} className="border-b border-border/50">
                            <td className="py-2 pr-3">{e.client_name ?? "—"}</td>
                            <td className="py-2 pr-3">{e.package_name}</td>
                            <td className="py-2 pr-3 font-medium">
                              {e.total_remaining} of {e.total_included}
                            </td>
                            <td className="py-2 text-muted-foreground">
                              {format(parseISO(e.expires_at), "d MMM yyyy")}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      </div>

      {/* New package definition */}
      <Dialog open={defOpen} onOpenChange={setDefOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>New package</DialogTitle>
            <DialogDescription>
              Bundle several services at one prepaid price. Each service keeps its own remaining
              count.
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-[70vh] space-y-3 overflow-y-auto pr-1">
            <div className="space-y-1.5">
              <Label>Name</Label>
              <Input
                dir="auto"
                value={defName}
                onChange={(e) => setDefName(e.target.value)}
                placeholder="e.g. Bridal Package"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Description (optional)</Label>
              <Textarea
                dir="auto"
                rows={2}
                value={defDesc}
                onChange={(e) => setDefDesc(e.target.value)}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Price ({currency})</Label>
                <Input
                  type="number"
                  step="0.01"
                  min="0"
                  value={defPrice}
                  onChange={(e) => setDefPrice(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Expires after (months)</Label>
                <Input
                  type="number"
                  min="1"
                  max="120"
                  value={defExpiry}
                  onChange={(e) => setDefExpiry(e.target.value)}
                  placeholder="Blank = never"
                />
              </div>
            </div>

            <div className="space-y-2 rounded-md border border-border p-3">
              <div className="flex items-center justify-between">
                <Label className="text-sm">Included services</Label>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    setDefLines((l) => [...l, { service_id: "", included_count: "1" }])
                  }
                >
                  <Plus className="mr-1 h-3 w-3" /> Add
                </Button>
              </div>
              {defLines.map((line, i) => (
                <div key={i} className="flex items-end gap-2">
                  <div className="flex-1 space-y-1">
                    <Label className="text-xs">Service</Label>
                    <Select
                      value={line.service_id}
                      onValueChange={(v) =>
                        setDefLines((rows) =>
                          rows.map((r, idx) => (idx === i ? { ...r, service_id: v } : r)),
                        )
                      }
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Select service" />
                      </SelectTrigger>
                      <SelectContent>
                        {services.map((s) => (
                          <SelectItem key={s.id} value={s.id}>
                            {s.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="w-24 space-y-1">
                    <Label className="text-xs">Count</Label>
                    <Input
                      type="number"
                      min="1"
                      step="1"
                      value={line.included_count}
                      onChange={(e) =>
                        setDefLines((rows) =>
                          rows.map((r, idx) =>
                            idx === i ? { ...r, included_count: e.target.value } : r,
                          ),
                        )
                      }
                    />
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setDefLines((rows) => rows.filter((_, idx) => idx !== i))}
                    disabled={defLines.length === 1}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              ))}
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDefOpen(false)}>
              Cancel
            </Button>
            <Button onClick={() => createType.mutate()} disabled={createType.isPending}>
              {createType.isPending ? "Creating…" : "Create package"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Goodwill expiry extension */}
      <Dialog open={!!extendFor} onOpenChange={(o) => !o && setExtendFor(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Extend expiry</DialogTitle>
            <DialogDescription>
              Sessions have already been used, so this package can't be refunded. Extending the
              expiry is the goodwill option instead.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              {extendFor?.clients?.name} · {extendFor?.package_types?.name}
              {extendFor?.expires_at
                ? ` · currently expires ${format(parseISO(extendFor.expires_at), "d MMM yyyy")}`
                : " · currently no expiry"}
            </p>
            <div className="space-y-1.5">
              <Label>New expiry date</Label>
              <Input
                type="date"
                value={extendDate}
                onChange={(e) => setExtendDate(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setExtendFor(null)}>
              Cancel
            </Button>
            <Button onClick={() => extend.mutate()} disabled={extend.isPending || !extendDate}>
              {extend.isPending ? "Saving…" : "Extend"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}
