import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { format, parseISO } from "date-fns";
import { Check, Copy, Gift, Plus } from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/hooks/use-tenant";
import { AppShell } from "@/components/app-shell";
import { errorMessage } from "@/lib/error-message";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export const Route = createFileRoute("/_authenticated/app/gift-cards")({
  head: () => ({
    meta: [{ title: "Gift cards — Q-Salon Suite" }, { name: "robots", content: "noindex" }],
  }),
  component: GiftCardsPage,
});

type PayMethod = "cash" | "card" | "bank_transfer";

type GiftCardRow = {
  id: string;
  code: string;
  initial_amount: number;
  remaining_amount: number;
  currency: string;
  expires_at: string | null;
  status: string;
  client_id: string | null;
  created_at: string;
  location_id: string;
};

type ExpiredRow = {
  id: string;
  code: string;
  initial_amount: number;
  remaining_amount: number;
  currency: string;
  expires_at: string;
  client_name: string | null;
  location_name: string | null;
};

/**
 * Expiry is derived here the same way the database derives it, rather than
 * trusting the stored `status` column — a card that expired since it was sold
 * would otherwise still read as "Active" until something wrote to it.
 */
function effectiveStatus(c: { status: string; expires_at: string | null; remaining_amount: number }) {
  if (c.status === "refunded") return "refunded";
  if (c.expires_at && new Date(c.expires_at) <= new Date()) return "expired";
  if (c.remaining_amount <= 0) return "redeemed";
  return "active";
}

function StatusBadge({ status }: { status: string }) {
  if (status === "active") return <Badge variant="secondary">Active</Badge>;
  if (status === "redeemed") return <Badge variant="outline">Fully used</Badge>;
  if (status === "refunded") return <Badge variant="outline">Refunded</Badge>;
  return (
    <Badge className="border-transparent bg-amber-100 text-amber-900 hover:bg-amber-100">
      Expired
    </Badge>
  );
}

function GiftCardsPage() {
  const tenant = useTenant();
  const qc = useQueryClient();
  const brandId = tenant.data?.brandId ?? null;
  const role = tenant.data?.primaryRole;
  const canSell = role === "owner" || role === "manager" || role === "receptionist";

  const brandQuery = useQuery({
    enabled: !!brandId,
    queryKey: ["gc-brand-settings", brandId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("brands")
        .select(
          "id, currency, gift_card_denominations, gift_card_expiry_enabled, gift_card_expiry_months",
        )
        .eq("id", brandId!)
        .single();
      if (error) throw error;
      return data;
    },
  });

  const locationsQuery = useQuery({
    enabled: !!brandId,
    queryKey: ["gc-locations", brandId],
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

  const cardsQuery = useQuery({
    enabled: !!brandId,
    queryKey: ["gift-cards", brandId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("gift_cards")
        .select(
          "id, code, initial_amount, remaining_amount, currency, expires_at, status, client_id, created_at, location_id",
        )
        .eq("brand_id", brandId!)
        .order("created_at", { ascending: false })
        .limit(200);
      if (error) throw error;
      return (data ?? []) as GiftCardRow[];
    },
  });

  const expiredQuery = useQuery({
    enabled: !!brandId,
    queryKey: ["gift-cards-expired", brandId],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("gift_cards_expired_with_balance", {
        _brand_id: brandId!,
      });
      if (error) throw error;
      return (data ?? []) as ExpiredRow[];
    },
  });

  const currency = brandQuery.data?.currency ?? "QAR";
  const denominations = useMemo(
    () => (brandQuery.data?.gift_card_denominations ?? []).map(Number).filter((n) => n > 0),
    [brandQuery.data?.gift_card_denominations],
  );

  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState<PayMethod>("cash");
  const [locationId, setLocationId] = useState<string>("");
  const [note, setNote] = useState("");
  const [lastSold, setLastSold] = useState<{ code: string; amount: number; expires: string | null } | null>(null);
  const [copied, setCopied] = useState(false);

  // Default to the user's own location where they have one; Owners pick.
  useEffect(() => {
    if (locationId) return;
    const own = tenant.data?.locationId;
    if (own) setLocationId(own);
    else if (locationsQuery.data?.length) setLocationId(locationsQuery.data[0].id);
  }, [tenant.data?.locationId, locationsQuery.data, locationId]);

  const sell = useMutation({
    mutationFn: async () => {
      const amt = Number(amount);
      if (!Number.isFinite(amt) || amt <= 0) throw new Error("Enter an amount greater than 0.");
      if (!locationId) throw new Error("Choose which location is selling this card.");

      const { data, error } = await supabase.rpc("gift_card_sell", {
        _brand_id: brandId!,
        _location_id: locationId,
        _amount: amt,
        _method: method,
        _note: note.trim() || undefined,
      });
      if (error) throw error;

      const row = Array.isArray(data) ? data[0] : data;
      // The RPC reports business failures as a row, not an exception, so that a
      // permission or validation problem reads as a clear message instead of a
      // raw Postgres error.
      if (!row || row.error) {
        throw new Error(
          row?.error === "forbidden"
            ? "You don't have permission to sell at this location."
            : row?.error === "invalid_amount"
              ? "Enter an amount greater than 0."
              : (row?.error ?? "Could not create the gift card."),
        );
      }
      return { code: row.code as string, amount: amt, expires: row.expires_at as string | null };
    },
    onSuccess: (res) => {
      setLastSold(res);
      setCopied(false);
      setAmount("");
      setNote("");
      toast.success(`Gift card ${res.code} sold`);
      qc.invalidateQueries({ queryKey: ["gift-cards", brandId] });
      qc.invalidateQueries({ queryKey: ["gift-cards-expired", brandId] });
    },
    onError: (e) => toast.error("Could not sell", { description: errorMessage(e, "Please try again.") }),
  });

  async function copyCode(code: string) {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      toast.success("Code copied");
    } catch {
      // Clipboard is permission-gated; the code is on screen either way.
      toast.message("Copy the code manually", { description: code });
    }
  }

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
          <h1 className="font-display text-2xl font-semibold">Gift cards</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            You don't have access to gift cards.
          </p>
        </div>
      </AppShell>
    );
  }

  const cards = cardsQuery.data ?? [];
  const expired = expiredQuery.data ?? [];
  const outstanding = cards
    .filter((c) => effectiveStatus(c) === "active")
    .reduce((sum, c) => sum + Number(c.remaining_amount), 0);

  return (
    <AppShell>
      <div className="p-6 md:p-10 max-w-6xl">
        <div className="mb-8">
          <h1 className="font-display text-3xl font-semibold tracking-tight">Gift cards</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Sell a gift card and track outstanding balances. Redeem at checkout on
            the appointment itself.
          </p>
        </div>

        <div className="grid gap-6 lg:grid-cols-3">
          <Card className="lg:col-span-1">
            <CardHeader>
              <CardTitle className="font-display text-lg flex items-center gap-2">
                <Gift className="h-4 w-4" /> Sell a gift card
              </CardTitle>
              <CardDescription>
                Money is logged as income straight away, the same as any other sale.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {denominations.length > 0 && (
                <div>
                  <Label className="text-xs">Suggested amounts</Label>
                  <div className="mt-1.5 flex flex-wrap gap-2">
                    {denominations.map((d) => (
                      <Button
                        key={d}
                        type="button"
                        size="sm"
                        variant={Number(amount) === d ? "default" : "outline"}
                        onClick={() => setAmount(String(d))}
                      >
                        {d} {currency}
                      </Button>
                    ))}
                  </div>
                </div>
              )}

              <div>
                <Label htmlFor="gc-amount">Amount ({currency})</Label>
                <Input
                  id="gc-amount"
                  type="number"
                  step="0.01"
                  min="0"
                  inputMode="decimal"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder="Any custom amount"
                />
                <p className="mt-1 text-xs text-muted-foreground">
                  Suggested amounts are a shortcut — any amount is allowed.
                </p>
              </div>

              <div>
                <Label htmlFor="gc-location">Location</Label>
                <Select value={locationId} onValueChange={setLocationId}>
                  <SelectTrigger id="gc-location">
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
                <Label htmlFor="gc-method">Payment</Label>
                <Select value={method} onValueChange={(v) => setMethod(v as PayMethod)}>
                  <SelectTrigger id="gc-method">
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
                <Label htmlFor="gc-note">Note (optional)</Label>
                <Input
                  id="gc-note"
                  dir="auto"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="e.g. gift for Mariam"
                />
              </div>

              <Button
                className="w-full"
                onClick={() => sell.mutate()}
                disabled={sell.isPending || !brandId}
              >
                <Plus className="mr-1.5 h-4 w-4" />
                {sell.isPending ? "Creating…" : "Sell gift card"}
              </Button>

              {lastSold && (
                <div className="rounded-md border border-border bg-muted/40 p-3">
                  <p className="text-xs text-muted-foreground">New gift card code</p>
                  <div className="mt-1 flex items-center gap-2">
                    <code className="font-mono text-lg font-semibold tracking-wider">
                      {lastSold.code}
                    </code>
                    <Button size="sm" variant="ghost" onClick={() => copyCode(lastSold.code)}>
                      {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                    </Button>
                  </div>
                  <p className="mt-1.5 text-xs text-muted-foreground">
                    {lastSold.amount} {currency}
                    {lastSold.expires
                      ? ` · expires ${format(parseISO(lastSold.expires), "d MMM yyyy")}`
                      : " · no expiry"}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Give this code to the customer — it's needed to redeem.
                  </p>
                </div>
              )}
            </CardContent>
          </Card>

          <div className="lg:col-span-2 space-y-6">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="font-display text-lg">Outstanding balance</CardTitle>
                <CardDescription>
                  Value sold but not yet redeemed — money already taken that the salon still owes in service.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <p className="font-display text-3xl font-semibold">
                  {outstanding.toFixed(2)} {currency}
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="font-display text-lg">All gift cards</CardTitle>
              </CardHeader>
              <CardContent>
                {cardsQuery.isLoading ? (
                  <Skeleton className="h-32 w-full" />
                ) : cards.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    No gift cards sold yet.
                  </p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-border text-left text-xs text-muted-foreground">
                          <th className="pb-2 pr-3 font-medium">Code</th>
                          <th className="pb-2 pr-3 font-medium">Value</th>
                          <th className="pb-2 pr-3 font-medium">Remaining</th>
                          <th className="pb-2 pr-3 font-medium">Expires</th>
                          <th className="pb-2 font-medium">Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {cards.map((c) => (
                          <tr key={c.id} className="border-b border-border/50">
                            <td className="py-2 pr-3">
                              <code className="font-mono text-xs">{c.code}</code>
                            </td>
                            <td className="py-2 pr-3">
                              {Number(c.initial_amount).toFixed(2)}
                            </td>
                            <td className="py-2 pr-3 font-medium">
                              {Number(c.remaining_amount).toFixed(2)}
                            </td>
                            <td className="py-2 pr-3 text-muted-foreground">
                              {c.expires_at
                                ? format(parseISO(c.expires_at), "d MMM yyyy")
                                : "—"}
                            </td>
                            <td className="py-2">
                              <StatusBadge status={effectiveStatus(c)} />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Section 11 is explicit that nothing happens automatically to
                these — this list exists so the Owner can decide case by case. */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="font-display text-lg">
                  Expired with balance remaining
                </CardTitle>
                <CardDescription>
                  Nothing happens to these automatically. Listed so you can decide
                  case by case whether to honour or extend them.
                </CardDescription>
              </CardHeader>
              <CardContent>
                {expiredQuery.isLoading ? (
                  <Skeleton className="h-20 w-full" />
                ) : expired.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    No expired gift cards with a remaining balance.
                  </p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-border text-left text-xs text-muted-foreground">
                          <th className="pb-2 pr-3 font-medium">Code</th>
                          <th className="pb-2 pr-3 font-medium">Unused</th>
                          <th className="pb-2 pr-3 font-medium">Expired</th>
                          <th className="pb-2 font-medium">Client</th>
                        </tr>
                      </thead>
                      <tbody>
                        {expired.map((c) => (
                          <tr key={c.id} className="border-b border-border/50">
                            <td className="py-2 pr-3">
                              <code className="font-mono text-xs">{c.code}</code>
                            </td>
                            <td className="py-2 pr-3 font-medium">
                              {Number(c.remaining_amount).toFixed(2)} {c.currency}
                            </td>
                            <td className="py-2 pr-3 text-muted-foreground">
                              {format(parseISO(c.expires_at), "d MMM yyyy")}
                            </td>
                            <td className="py-2 text-muted-foreground">
                              {c.client_name ?? "Never redeemed"}
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
    </AppShell>
  );
}
