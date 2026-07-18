import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Search, Pencil, PackagePlus, AlertTriangle, History } from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { useTenant, type AppRole } from "@/hooks/use-tenant";
import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";

export const Route = createFileRoute("/_authenticated/app/stock")({
  head: () => ({
    meta: [
      { title: "Stock — Lumen Salon Suite" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: StockPage,
});

type ProductRow = {
  id: string;
  brand_id: string;
  name: string;
  sku: string | null;
  supplier: string | null;
  unit: string;
  cost_price: number;
  currency: string;
  is_active: boolean;
};

type LocationRow = { id: string; name: string };

type StockRow = {
  id: string;
  product_id: string;
  location_id: string;
  quantity: number;
  low_stock_threshold: number;
};

type MovementType = "restock" | "usage" | "waste" | "adjustment";

type MovementRow = {
  id: string;
  location_id: string;
  product_id: string;
  movement_type: MovementType;
  quantity: number;
  notes: string | null;
  created_by: string | null;
  created_at: string;
};

const UNITS = ["unit", "ml", "g", "kg", "l", "box", "pack", "bottle"];

function StockPage() {
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

  const role = tenant.data?.primaryRole;
  const brandId = tenant.data?.brandId;
  const userLocationId = tenant.data?.locationId ?? null;

  if (!brandId || role === "staff") {
    return (
      <AppShell>
        <div className="p-8">
          <Card className="p-8 text-center">
            <h1 className="font-display text-xl font-semibold">Not available</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              Stock is managed by Owners, Managers, and Receptionists.
            </p>
          </Card>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <StockInner
        brandId={brandId}
        role={role as AppRole}
        userLocationId={userLocationId}
      />
    </AppShell>
  );
}

function StockInner({
  brandId,
  role,
  userLocationId,
}: {
  brandId: string;
  role: AppRole;
  userLocationId: string | null;
}) {
  const isOwner = role === "owner";
  const canManage = role === "owner" || role === "manager";

  const locationsQ = useQuery({
    queryKey: ["locations", brandId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("locations")
        .select("id, name")
        .eq("brand_id", brandId)
        .eq("is_active", true)
        .order("name");
      if (error) throw error;
      return (data ?? []) as LocationRow[];
    },
  });

  const locations = locationsQ.data ?? [];

  // Owner can pick "all" or a specific one. Others locked to userLocationId.
  const [selectedLocation, setSelectedLocation] = useState<string>(
    isOwner ? "all" : userLocationId ?? "",
  );

  // When locations load and manager has no locationId, fall back to first
  const effectiveLocation =
    !isOwner && !selectedLocation && locations.length > 0
      ? locations[0].id
      : selectedLocation;

  const [tab, setTab] = useState<"levels" | "products" | "history">("levels");

  return (
    <div className="mx-auto max-w-6xl p-6 md:p-8">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl font-semibold tracking-tight">
            Stock
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Track product levels, restocks, usage, and waste across your locations.
          </p>
        </div>
        {isOwner ? (
          <Select value={selectedLocation} onValueChange={setSelectedLocation}>
            <SelectTrigger className="w-[220px]">
              <SelectValue placeholder="Location" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All locations</SelectItem>
              {locations.map((l) => (
                <SelectItem key={l.id} value={l.id}>
                  {l.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : (
          <div className="rounded-md border bg-muted/40 px-3 py-2 text-sm">
            {locations.find((l) => l.id === effectiveLocation)?.name ?? "—"}
          </div>
        )}
      </div>

      <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)}>
        <TabsList>
          <TabsTrigger value="levels">Stock levels</TabsTrigger>
          <TabsTrigger value="products">Products</TabsTrigger>
          <TabsTrigger value="history">Movements</TabsTrigger>
        </TabsList>

        <TabsContent value="levels" className="mt-4">
          <StockLevels
            brandId={brandId}
            canManage={canManage}
            isOwner={isOwner}
            locations={locations}
            selectedLocation={effectiveLocation}
          />
        </TabsContent>

        <TabsContent value="products" className="mt-4">
          <ProductsTab brandId={brandId} canManage={canManage} />
        </TabsContent>

        <TabsContent value="history" className="mt-4">
          <MovementsHistory
            brandId={brandId}
            isOwner={isOwner}
            locations={locations}
            selectedLocation={effectiveLocation}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Stock levels                                                        */
/* ------------------------------------------------------------------ */

function statusFor(qty: number, threshold: number) {
  if (qty <= 0) return "out" as const;
  if (qty <= threshold) return "low" as const;
  return "ok" as const;
}

function StatusBadge({ status }: { status: "ok" | "low" | "out" }) {
  if (status === "out")
    return <Badge className="bg-destructive text-destructive-foreground hover:bg-destructive">Out</Badge>;
  if (status === "low")
    return <Badge className="bg-amber-500 text-white hover:bg-amber-500">Low</Badge>;
  return <Badge variant="secondary">OK</Badge>;
}

function StockLevels({
  brandId,
  canManage,
  isOwner,
  locations,
  selectedLocation,
}: {
  brandId: string;
  canManage: boolean;
  isOwner: boolean;
  locations: LocationRow[];
  selectedLocation: string;
}) {
  const qc = useQueryClient();
  const [query, setQuery] = useState("");
  const [onlyLow, setOnlyLow] = useState(false);
  const [movementFor, setMovementFor] = useState<{
    product: ProductRow;
    location_id: string;
  } | null>(null);

  const isAllLocations = isOwner && selectedLocation === "all";

  const productsQ = useQuery({
    queryKey: ["products", brandId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("products")
        .select("*")
        .eq("brand_id", brandId)
        .order("name");
      if (error) throw error;
      return (data ?? []) as ProductRow[];
    },
  });

  const stockQ = useQuery({
    queryKey: ["location_stock", brandId, selectedLocation],
    enabled: !!selectedLocation,
    queryFn: async () => {
      const locIds = isAllLocations
        ? locations.map((l) => l.id)
        : [selectedLocation];
      if (locIds.length === 0) return [] as StockRow[];
      const { data, error } = await supabase
        .from("location_stock")
        .select("id, product_id, location_id, quantity, low_stock_threshold")
        .in("location_id", locIds);
      if (error) throw error;
      return (data ?? []) as StockRow[];
    },
  });

  const updateThreshold = useMutation({
    mutationFn: async ({
      product_id,
      location_id,
      threshold,
    }: {
      product_id: string;
      location_id: string;
      threshold: number;
    }) => {
      // upsert
      const { error } = await supabase
        .from("location_stock")
        .upsert(
          {
            product_id,
            location_id,
            low_stock_threshold: threshold,
          } as never,
          { onConflict: "location_id,product_id" },
        );
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["location_stock", brandId] });
      toast.success("Threshold updated");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const products = productsQ.data ?? [];
  const stockRows = stockQ.data ?? [];

  // rows: per (product x location) in scope, showing merged current
  type Row = {
    product: ProductRow;
    location_id: string;
    location_name: string;
    quantity: number;
    threshold: number;
  };

  const rows: Row[] = useMemo(() => {
    const activeProducts = products.filter((p) => p.is_active);
    const locsInScope = isAllLocations ? locations : locations.filter((l) => l.id === selectedLocation);
    const stockMap = new Map<string, StockRow>();
    stockRows.forEach((s) => stockMap.set(`${s.location_id}:${s.product_id}`, s));
    const out: Row[] = [];
    for (const p of activeProducts) {
      for (const loc of locsInScope) {
        const s = stockMap.get(`${loc.id}:${p.id}`);
        out.push({
          product: p,
          location_id: loc.id,
          location_name: loc.name,
          quantity: s?.quantity ?? 0,
          threshold: s?.low_stock_threshold ?? 0,
        });
      }
    }
    return out;
  }, [products, stockRows, locations, isAllLocations, selectedLocation]);

  const filtered = useMemo(() => {
    return rows.filter((r) => {
      const st = statusFor(r.quantity, r.threshold);
      if (onlyLow && st === "ok") return false;
      if (query) {
        const q = query.toLowerCase();
        if (
          !r.product.name.toLowerCase().includes(q) &&
          !(r.product.sku ?? "").toLowerCase().includes(q)
        )
          return false;
      }
      return true;
    });
  }, [rows, onlyLow, query]);

  // Low-stock summary
  const summary = useMemo(() => {
    const perLocation = new Map<string, { name: string; low: number; out: number }>();
    let low = 0;
    let out = 0;
    for (const r of rows) {
      const st = statusFor(r.quantity, r.threshold);
      if (st === "ok") continue;
      const s = perLocation.get(r.location_id) ?? {
        name: r.location_name,
        low: 0,
        out: 0,
      };
      if (st === "low") {
        s.low += 1;
        low += 1;
      } else {
        s.out += 1;
        out += 1;
      }
      perLocation.set(r.location_id, s);
    }
    return { low, out, perLocation };
  }, [rows]);

  return (
    <div>
      {(summary.low > 0 || summary.out > 0) && (
        <Card className="mb-4 border-amber-500/50 bg-amber-50/50 p-4 dark:bg-amber-950/20">
          <div className="flex items-start gap-3">
            <AlertTriangle className="mt-0.5 h-5 w-5 text-amber-600" />
            <div className="flex-1">
              <div className="font-medium">
                {summary.out + summary.low} product
                {summary.out + summary.low === 1 ? "" : "s"} low or out of stock
                {isAllLocations ? " across your brand" : " at this location"}
              </div>
              {isAllLocations && summary.perLocation.size > 0 && (
                <ul className="mt-2 space-y-1 text-sm text-muted-foreground">
                  {Array.from(summary.perLocation.values()).map((s) => (
                    <li key={s.name}>
                      <span className="font-medium text-foreground">{s.name}</span>
                      : {s.out > 0 && <span className="text-destructive">{s.out} out</span>}
                      {s.out > 0 && s.low > 0 && <span>, </span>}
                      {s.low > 0 && <span className="text-amber-700">{s.low} low</span>}
                    </li>
                  ))}
                </ul>
              )}
              <Button
                variant="link"
                className="mt-1 h-auto p-0"
                onClick={() => setOnlyLow(true)}
              >
                Show only low & out of stock →
              </Button>
            </div>
          </div>
        </Card>
      )}

      <Card className="mb-4 p-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative flex-1 min-w-[220px]">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by product name or SKU"
              className="pl-9"
            />
          </div>
          <label className="flex items-center gap-2 text-sm text-muted-foreground">
            <Switch checked={onlyLow} onCheckedChange={setOnlyLow} />
            Low & out only
          </label>
        </div>
      </Card>

      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Product</TableHead>
              {isAllLocations && <TableHead>Location</TableHead>}
              <TableHead className="w-[140px]">Quantity</TableHead>
              <TableHead className="w-[160px]">Low threshold</TableHead>
              <TableHead className="w-[100px]">Status</TableHead>
              {canManage && <TableHead className="w-[140px]"></TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {productsQ.isLoading || stockQ.isLoading ? (
              <TableRow>
                <TableCell colSpan={6}>
                  <Skeleton className="h-24 w-full" />
                </TableCell>
              </TableRow>
            ) : filtered.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={6}
                  className="py-10 text-center text-sm text-muted-foreground"
                >
                  No stock rows to show.
                </TableCell>
              </TableRow>
            ) : (
              filtered.map((r) => {
                const st = statusFor(r.quantity, r.threshold);
                return (
                  <TableRow key={`${r.location_id}:${r.product.id}`}>
                    <TableCell>
                      <div className="font-medium">{r.product.name}</div>
                      {r.product.sku && (
                        <div className="text-xs text-muted-foreground">
                          SKU {r.product.sku}
                        </div>
                      )}
                    </TableCell>
                    {isAllLocations && <TableCell>{r.location_name}</TableCell>}
                    <TableCell className="font-mono">
                      {r.quantity} {r.product.unit}
                    </TableCell>
                    <TableCell>
                      {canManage ? (
                        <ThresholdInput
                          value={r.threshold}
                          onSave={(v) =>
                            updateThreshold.mutate({
                              product_id: r.product.id,
                              location_id: r.location_id,
                              threshold: v,
                            })
                          }
                        />
                      ) : (
                        <span className="font-mono text-muted-foreground">
                          {r.threshold}
                        </span>
                      )}
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={st} />
                    </TableCell>
                    {canManage && (
                      <TableCell>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() =>
                            setMovementFor({
                              product: r.product,
                              location_id: r.location_id,
                            })
                          }
                        >
                          <PackagePlus className="mr-1 h-4 w-4" /> Log
                        </Button>
                      </TableCell>
                    )}
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </Card>

      {movementFor && (
        <MovementDialog
          product={movementFor.product}
          locationId={movementFor.location_id}
          onClose={() => setMovementFor(null)}
        />
      )}
    </div>
  );
}

function ThresholdInput({
  value,
  onSave,
}: {
  value: number;
  onSave: (v: number) => void;
}) {
  const [v, setV] = useState(String(value));
  return (
    <Input
      type="number"
      min={0}
      step="0.01"
      value={v}
      onChange={(e) => setV(e.target.value)}
      onBlur={() => {
        const n = Number(v);
        if (Number.isFinite(n) && n !== value) onSave(n);
      }}
      className="h-8 w-24 font-mono"
    />
  );
}

/* ------------------------------------------------------------------ */
/* Movement dialog                                                     */
/* ------------------------------------------------------------------ */

function MovementDialog({
  product,
  locationId,
  onClose,
}: {
  product: ProductRow;
  locationId: string;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [type, setType] = useState<MovementType>("restock");
  const [quantity, setQuantity] = useState("1");
  const [notes, setNotes] = useState("");

  const save = useMutation({
    mutationFn: async () => {
      const qty = Number(quantity);
      if (!Number.isFinite(qty) || qty === 0) throw new Error("Enter a quantity");
      const { data: userData } = await supabase.auth.getUser();
      const uid = userData.user?.id;
      if (!uid) throw new Error("Not signed in");
      const { error } = await supabase.from("stock_movements").insert({
        product_id: product.id,
        location_id: locationId,
        movement_type: type,
        quantity: qty,
        notes: notes || null,
        created_by: uid,
      } as never);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["location_stock"] });
      qc.invalidateQueries({ queryKey: ["stock_movements"] });
      toast.success("Movement logged");
      onClose();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Log stock movement</DialogTitle>
          <DialogDescription>
            {product.name} · {product.unit}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          <div>
            <Label>Type</Label>
            <Select value={type} onValueChange={(v) => setType(v as MovementType)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="restock">Restock (+)</SelectItem>
                <SelectItem value="usage">Usage (−)</SelectItem>
                <SelectItem value="waste">Waste (−)</SelectItem>
                <SelectItem value="adjustment">Adjustment (−)</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label>Quantity ({product.unit})</Label>
            <Input
              type="number"
              min={0}
              step="0.01"
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
            />
          </div>

          <div>
            <Label>Notes</Label>
            <Textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Optional"
              dir="auto"
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => save.mutate()} disabled={save.isPending}>
            {save.isPending ? "Saving..." : "Save movement"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ */
/* Products tab                                                        */
/* ------------------------------------------------------------------ */

function ProductsTab({
  brandId,
  canManage,
}: {
  brandId: string;
  canManage: boolean;
}) {
  const qc = useQueryClient();
  const [query, setQuery] = useState("");
  const [showInactive, setShowInactive] = useState(false);
  const [editing, setEditing] = useState<ProductRow | null>(null);
  const [creating, setCreating] = useState(false);

  const productsQ = useQuery({
    queryKey: ["products", brandId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("products")
        .select("*")
        .eq("brand_id", brandId)
        .order("name");
      if (error) throw error;
      return (data ?? []) as ProductRow[];
    },
  });

  const toggleActive = useMutation({
    mutationFn: async ({ id, is_active }: { id: string; is_active: boolean }) => {
      if (!is_active) {
        // Check history before hard-deleting is n/a here — we only toggle.
      }
      const { error } = await supabase
        .from("products")
        .update({ is_active })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["products", brandId] });
      toast.success("Product updated");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const filtered = useMemo(() => {
    const list = productsQ.data ?? [];
    return list.filter((p) => {
      if (!showInactive && !p.is_active) return false;
      if (query) {
        const q = query.toLowerCase();
        if (
          !p.name.toLowerCase().includes(q) &&
          !(p.sku ?? "").toLowerCase().includes(q) &&
          !(p.supplier ?? "").toLowerCase().includes(q)
        )
          return false;
      }
      return true;
    });
  }, [productsQ.data, showInactive, query]);

  return (
    <div>
      <Card className="mb-4 p-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative flex-1 min-w-[220px]">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search products, SKU, supplier"
              className="pl-9"
            />
          </div>
          <label className="flex items-center gap-2 text-sm text-muted-foreground">
            <Switch checked={showInactive} onCheckedChange={setShowInactive} />
            Show inactive
          </label>
          {canManage && (
            <Button onClick={() => setCreating(true)}>
              <Plus className="mr-2 h-4 w-4" /> Add product
            </Button>
          )}
        </div>
      </Card>

      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>SKU</TableHead>
              <TableHead>Supplier</TableHead>
              <TableHead className="w-[100px]">Unit</TableHead>
              <TableHead className="w-[140px]">Cost</TableHead>
              <TableHead className="w-[120px]">Status</TableHead>
              {canManage && <TableHead className="w-[60px]"></TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {productsQ.isLoading ? (
              <TableRow>
                <TableCell colSpan={7}>
                  <Skeleton className="h-24 w-full" />
                </TableCell>
              </TableRow>
            ) : filtered.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={7}
                  className="py-10 text-center text-sm text-muted-foreground"
                >
                  No products yet.
                </TableCell>
              </TableRow>
            ) : (
              filtered.map((p) => (
                <TableRow key={p.id} className={!p.is_active ? "opacity-60" : ""}>
                  <TableCell className="font-medium">{p.name}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {p.sku ?? "—"}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {p.supplier ?? "—"}
                  </TableCell>
                  <TableCell>{p.unit}</TableCell>
                  <TableCell className="font-mono">
                    {Number(p.cost_price).toFixed(2)} {p.currency}
                  </TableCell>
                  <TableCell>
                    {canManage ? (
                      <div className="flex items-center gap-2">
                        <Switch
                          checked={p.is_active}
                          onCheckedChange={(v) =>
                            toggleActive.mutate({ id: p.id, is_active: v })
                          }
                        />
                        <span className="text-xs text-muted-foreground">
                          {p.is_active ? "Active" : "Inactive"}
                        </span>
                      </div>
                    ) : (
                      <Badge variant={p.is_active ? "default" : "outline"}>
                        {p.is_active ? "Active" : "Inactive"}
                      </Badge>
                    )}
                  </TableCell>
                  {canManage && (
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setEditing(p)}
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  )}
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </Card>

      {creating && (
        <ProductDialog
          mode="create"
          brandId={brandId}
          onClose={() => setCreating(false)}
        />
      )}
      {editing && (
        <ProductDialog
          mode="edit"
          brandId={brandId}
          product={editing}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}

function ProductDialog({
  mode,
  brandId,
  product,
  onClose,
}: {
  mode: "create" | "edit";
  brandId: string;
  product?: ProductRow;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [name, setName] = useState(product?.name ?? "");
  const [sku, setSku] = useState(product?.sku ?? "");
  const [supplier, setSupplier] = useState(product?.supplier ?? "");
  const [unit, setUnit] = useState(product?.unit ?? "unit");
  const [costPrice, setCostPrice] = useState(String(product?.cost_price ?? "0"));
  const [currency, setCurrency] = useState(product?.currency ?? "QAR");

  const save = useMutation({
    mutationFn: async () => {
      if (!name.trim()) throw new Error("Name is required");
      const payload = {
        name: name.trim(),
        sku: sku.trim() || null,
        supplier: supplier.trim() || null,
        unit,
        cost_price: Number(costPrice) || 0,
        currency,
        brand_id: brandId,
      };
      if (mode === "create") {
        const { error } = await supabase.from("products").insert(payload as never);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from("products")
          .update(payload)
          .eq("id", product!.id);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["products", brandId] });
      toast.success(mode === "create" ? "Product added" : "Product updated");
      onClose();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {mode === "create" ? "Add product" : "Edit product"}
          </DialogTitle>
          <DialogDescription>
            Products are shared across all locations in your brand.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          <div>
            <Label>Name *</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} dir="auto" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>SKU</Label>
              <Input value={sku} onChange={(e) => setSku(e.target.value)} />
            </div>
            <div>
              <Label>Supplier</Label>
              <Input value={supplier} onChange={(e) => setSupplier(e.target.value)} />
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <Label>Unit</Label>
              <Select value={unit} onValueChange={setUnit}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {UNITS.map((u) => (
                    <SelectItem key={u} value={u}>
                      {u}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Cost price</Label>
              <Input
                type="number"
                min={0}
                step="0.01"
                value={costPrice}
                onChange={(e) => setCostPrice(e.target.value)}
              />
            </div>
            <div>
              <Label>Currency</Label>
              <Input
                value={currency}
                onChange={(e) => setCurrency(e.target.value.toUpperCase())}
                maxLength={3}
              />
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => save.mutate()} disabled={save.isPending}>
            {save.isPending ? "Saving..." : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ */
/* Movements history                                                   */
/* ------------------------------------------------------------------ */

function MovementsHistory({
  brandId,
  isOwner,
  locations,
  selectedLocation,
}: {
  brandId: string;
  isOwner: boolean;
  locations: LocationRow[];
  selectedLocation: string;
}) {
  const [productFilter, setProductFilter] = useState<string>("all");
  const [typeFilter, setTypeFilter] = useState<string>("all");

  const isAllLocations = isOwner && selectedLocation === "all";

  const productsQ = useQuery({
    queryKey: ["products", brandId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("products")
        .select("id, name, unit")
        .eq("brand_id", brandId)
        .order("name");
      if (error) throw error;
      return (data ?? []) as { id: string; name: string; unit: string }[];
    },
  });

  const movementsQ = useQuery({
    queryKey: [
      "stock_movements",
      brandId,
      selectedLocation,
      productFilter,
      typeFilter,
    ],
    enabled: !!selectedLocation,
    queryFn: async () => {
      const locIds = isAllLocations ? locations.map((l) => l.id) : [selectedLocation];
      if (locIds.length === 0) return [] as MovementRow[];
      let q = supabase
        .from("stock_movements")
        .select("*")
        .in("location_id", locIds)
        .order("created_at", { ascending: false })
        .limit(200);
      if (productFilter !== "all") q = q.eq("product_id", productFilter);
      if (typeFilter !== "all") q = q.eq("movement_type", typeFilter as MovementType);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as MovementRow[];
    },
  });

  const profilesQ = useQuery({
    queryKey: [
      "profiles-for-movements",
      (movementsQ.data ?? []).map((m) => m.created_by).join(","),
    ],
    enabled: (movementsQ.data ?? []).length > 0,
    queryFn: async () => {
      const ids = Array.from(
        new Set(
          (movementsQ.data ?? [])
            .map((m) => m.created_by)
            .filter((x): x is string => !!x),
        ),
      );
      if (ids.length === 0) return [] as { id: string; full_name: string | null }[];
      const { data, error } = await supabase
        .from("profiles")
        .select("id, full_name")
        .in("id", ids);
      if (error) throw error;
      return (data ?? []) as { id: string; full_name: string | null }[];
    },
  });

  const productMap = useMemo(() => {
    const m = new Map<string, { name: string; unit: string }>();
    (productsQ.data ?? []).forEach((p) => m.set(p.id, { name: p.name, unit: p.unit }));
    return m;
  }, [productsQ.data]);

  const locationMap = useMemo(() => {
    const m = new Map<string, string>();
    locations.forEach((l) => m.set(l.id, l.name));
    return m;
  }, [locations]);

  const profileMap = useMemo(() => {
    const m = new Map<string, string>();
    (profilesQ.data ?? []).forEach((p) => m.set(p.id, p.full_name ?? "—"));
    return m;
  }, [profilesQ.data]);

  return (
    <div>
      <Card className="mb-4 p-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <History className="h-4 w-4" /> Movements
          </div>
          <Select value={productFilter} onValueChange={setProductFilter}>
            <SelectTrigger className="w-[220px]">
              <SelectValue placeholder="Product" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All products</SelectItem>
              {(productsQ.data ?? []).map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={typeFilter} onValueChange={setTypeFilter}>
            <SelectTrigger className="w-[160px]">
              <SelectValue placeholder="Type" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All types</SelectItem>
              <SelectItem value="restock">Restock</SelectItem>
              <SelectItem value="usage">Usage</SelectItem>
              <SelectItem value="waste">Waste</SelectItem>
              <SelectItem value="adjustment">Adjustment</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </Card>

      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[170px]">Date</TableHead>
              <TableHead>Product</TableHead>
              {isAllLocations && <TableHead>Location</TableHead>}
              <TableHead className="w-[120px]">Type</TableHead>
              <TableHead className="w-[120px]">Quantity</TableHead>
              <TableHead>Notes</TableHead>
              <TableHead className="w-[160px]">By</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {movementsQ.isLoading ? (
              <TableRow>
                <TableCell colSpan={7}>
                  <Skeleton className="h-24 w-full" />
                </TableCell>
              </TableRow>
            ) : (movementsQ.data ?? []).length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={7}
                  className="py-10 text-center text-sm text-muted-foreground"
                >
                  No movements yet.
                </TableCell>
              </TableRow>
            ) : (
              (movementsQ.data ?? []).map((m) => {
                const p = productMap.get(m.product_id);
                const signed =
                  m.movement_type === "restock" ? `+${m.quantity}` : `−${m.quantity}`;
                return (
                  <TableRow key={m.id}>
                    <TableCell className="text-sm text-muted-foreground">
                      {new Date(m.created_at).toLocaleString()}
                    </TableCell>
                    <TableCell className="font-medium">
                      {p?.name ?? "Unknown"}
                    </TableCell>
                    {isAllLocations && (
                      <TableCell>{locationMap.get(m.location_id) ?? "—"}</TableCell>
                    )}
                    <TableCell>
                      <Badge
                        variant={m.movement_type === "restock" ? "default" : "secondary"}
                        className="capitalize"
                      >
                        {m.movement_type}
                      </Badge>
                    </TableCell>
                    <TableCell className="font-mono">
                      {signed} {p?.unit ?? ""}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {m.notes ?? "—"}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {m.created_by ? profileMap.get(m.created_by) ?? "—" : "—"}
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}
