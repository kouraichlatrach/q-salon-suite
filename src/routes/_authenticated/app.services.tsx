import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Search, Pencil, Ban } from "lucide-react";
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

export const Route = createFileRoute("/_authenticated/app/services")({
  head: () => ({
    meta: [
      { title: "Services — Lumen Salon Suite" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: ServicesPage,
});

type ServiceRow = {
  id: string;
  brand_id: string;
  name: string;
  category: string | null;
  description: string | null;
  duration_minutes: number;
  default_price: number;
  currency: string;
  is_active: boolean;
};

type LocationRow = { id: string; name: string };

type OverrideRow = {
  id: string;
  service_id: string;
  location_id: string;
  price: number;
  currency: string;
};

const CATEGORIES = ["Hair", "Nails", "Skin", "Spa", "Makeup", "Package", "Other"];

function ServicesPage() {
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
  const managerLocationId = tenant.data?.locationId ?? null;

  if (!brandId || (role !== "owner" && role !== "manager")) {
    return (
      <AppShell>
        <div className="p-8">
          <Card className="p-8 text-center">
            <h1 className="font-display text-xl font-semibold">Not available</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              Services catalog is managed by Owners and Location Managers.
            </p>
          </Card>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <ServicesInner
        brandId={brandId}
        role={role as AppRole}
        managerLocationId={managerLocationId}
      />
    </AppShell>
  );
}

function ServicesInner({
  brandId,
  role,
  managerLocationId,
}: {
  brandId: string;
  role: AppRole;
  managerLocationId: string | null;
}) {
  const qc = useQueryClient();
  const isOwner = role === "owner";
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<string>("all");
  const [showInactive, setShowInactive] = useState(false);
  const [editing, setEditing] = useState<ServiceRow | null>(null);
  const [creating, setCreating] = useState(false);

  const servicesQ = useQuery({
    queryKey: ["services", brandId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("services")
        .select("*")
        .eq("brand_id", brandId)
        .order("name");
      if (error) throw error;
      return (data ?? []) as ServiceRow[];
    },
  });

  const locationsQ = useQuery({
    queryKey: ["locations", brandId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("locations")
        .select("id, name")
        .eq("brand_id", brandId)
        .order("name");
      if (error) throw error;
      return (data ?? []) as LocationRow[];
    },
  });

  // Manager: fetch override prices for their location so column can show effective price
  const managerOverridesQ = useQuery({
    enabled: !isOwner && !!managerLocationId,
    queryKey: ["service_location_prices", managerLocationId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("service_location_prices")
        .select("service_id, price, currency")
        .eq("location_id", managerLocationId!);
      if (error) throw error;
      return (data ?? []) as { service_id: string; price: number; currency: string }[];
    },
  });

  const toggleActive = useMutation({
    mutationFn: async ({ id, is_active }: { id: string; is_active: boolean }) => {
      const { error } = await supabase
        .from("services")
        .update({ is_active })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["services", brandId] });
      toast.success("Service updated");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const filtered = useMemo(() => {
    const list = servicesQ.data ?? [];
    return list.filter((s) => {
      if (!showInactive && !s.is_active) return false;
      if (category !== "all" && (s.category ?? "") !== category) return false;
      if (query) {
        const q = query.toLowerCase();
        if (
          !s.name.toLowerCase().includes(q) &&
          !(s.category ?? "").toLowerCase().includes(q)
        )
          return false;
      }
      return true;
    });
  }, [servicesQ.data, showInactive, category, query]);

  const managerOverrideMap = useMemo(() => {
    const map = new Map<string, { price: number; currency: string }>();
    (managerOverridesQ.data ?? []).forEach((o) =>
      map.set(o.service_id, { price: o.price, currency: o.currency }),
    );
    return map;
  }, [managerOverridesQ.data]);

  return (
    <div className="mx-auto max-w-6xl p-6 md:p-8">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl font-semibold tracking-tight">
            Services
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {isOwner
              ? "Manage your brand's service catalog and per-location pricing."
              : "View your brand's service catalog and your location's effective pricing."}
          </p>
        </div>
        {isOwner && (
          <Button onClick={() => setCreating(true)}>
            <Plus className="mr-2 h-4 w-4" /> Add service
          </Button>
        )}
      </div>

      <Card className="mb-4 p-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative flex-1 min-w-[220px]">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by name or category"
              className="pl-9"
            />
          </div>
          <Select value={category} onValueChange={setCategory}>
            <SelectTrigger className="w-[180px]">
              <SelectValue placeholder="Category" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All categories</SelectItem>
              {CATEGORIES.map((c) => (
                <SelectItem key={c} value={c}>
                  {c}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <label className="flex items-center gap-2 text-sm text-muted-foreground">
            <Switch checked={showInactive} onCheckedChange={setShowInactive} />
            Show inactive
          </label>
        </div>
      </Card>

      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Category</TableHead>
              <TableHead className="w-[120px]">Duration</TableHead>
              <TableHead className="w-[160px]">
                {isOwner ? "Default price" : "Your price"}
              </TableHead>
              <TableHead className="w-[120px]">Status</TableHead>
              <TableHead className="w-[80px]"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {servicesQ.isLoading ? (
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
                  No services yet.{" "}
                  {isOwner && "Click \"Add service\" to create your first one."}
                </TableCell>
              </TableRow>
            ) : (
              filtered.map((s) => {
                const effective = !isOwner
                  ? managerOverrideMap.get(s.id)
                  : undefined;
                const price = effective?.price ?? s.default_price;
                const currency = effective?.currency ?? s.currency;
                return (
                  <TableRow key={s.id} className={!s.is_active ? "opacity-60" : ""}>
                    <TableCell className="font-medium">{s.name}</TableCell>
                    <TableCell>
                      {s.category ? (
                        <Badge variant="secondary">{s.category}</Badge>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell>{s.duration_minutes} min</TableCell>
                    <TableCell className="font-mono">
                      {price.toFixed(2)} {currency}
                      {!isOwner && effective && (
                        <span className="ml-2 text-xs text-muted-foreground">
                          (override)
                        </span>
                      )}
                    </TableCell>
                    <TableCell>
                      {isOwner ? (
                        <div className="flex items-center gap-2">
                          <Switch
                            checked={s.is_active}
                            onCheckedChange={(v) =>
                              toggleActive.mutate({ id: s.id, is_active: v })
                            }
                          />
                          <span className="text-xs text-muted-foreground">
                            {s.is_active ? "Active" : "Inactive"}
                          </span>
                        </div>
                      ) : (
                        <Badge variant={s.is_active ? "default" : "outline"}>
                          {s.is_active ? "Active" : "Inactive"}
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setEditing(s)}
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </Card>

      {creating && isOwner && (
        <ServiceDialog
          mode="create"
          brandId={brandId}
          locations={locationsQ.data ?? []}
          onClose={() => setCreating(false)}
        />
      )}

      {editing && (
        <ServiceDialog
          mode="edit"
          service={editing}
          brandId={brandId}
          locations={locationsQ.data ?? []}
          isOwner={isOwner}
          managerLocationId={managerLocationId}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}

function ServiceDialog({
  mode,
  service,
  brandId,
  locations,
  isOwner = true,
  managerLocationId = null,
  onClose,
}: {
  mode: "create" | "edit";
  service?: ServiceRow;
  brandId: string;
  locations: LocationRow[];
  isOwner?: boolean;
  managerLocationId?: string | null;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [name, setName] = useState(service?.name ?? "");
  const [category, setCategory] = useState(service?.category ?? "");
  const [description, setDescription] = useState(service?.description ?? "");
  const [duration, setDuration] = useState(service?.duration_minutes ?? 60);
  const [defaultPrice, setDefaultPrice] = useState(service?.default_price ?? 0);
  const [currency, setCurrency] = useState(service?.currency ?? "QAR");
  const [isActive, setIsActive] = useState(service?.is_active ?? true);

  const overridesQ = useQuery({
    enabled: mode === "edit" && !!service,
    queryKey: ["service_overrides", service?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("service_location_prices")
        .select("*")
        .eq("service_id", service!.id);
      if (error) throw error;
      return (data ?? []) as OverrideRow[];
    },
  });

  const save = useMutation({
    mutationFn: async () => {
      if (!name.trim()) throw new Error("Name is required");
      if (duration <= 0) throw new Error("Duration must be greater than 0");
      const payload = {
        brand_id: brandId,
        name: name.trim(),
        category: category.trim() || null,
        description: description.trim() || null,
        duration_minutes: Math.round(duration),
        default_price: Number(defaultPrice),
        currency: currency.trim() || "QAR",
        is_active: isActive,
      };
      if (mode === "create") {
        const { error } = await supabase.from("services").insert(payload);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from("services")
          .update(payload)
          .eq("id", service!.id);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["services", brandId] });
      toast.success(mode === "create" ? "Service created" : "Service updated");
      onClose();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const deactivate = useMutation({
    mutationFn: async () => {
      // Check appointment references before hard-delete; we soft-disable instead
      const { count, error: countErr } = await supabase
        .from("appointments")
        .select("id", { count: "exact", head: true })
        .eq("service_id", service!.id);
      if (countErr) throw countErr;
      if ((count ?? 0) > 0) {
        // History exists — deactivate
        const { error } = await supabase
          .from("services")
          .update({ is_active: false })
          .eq("id", service!.id);
        if (error) throw error;
        return { deleted: false };
      }
      const { error } = await supabase.from("services").delete().eq("id", service!.id);
      if (error) throw error;
      return { deleted: true };
    },
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ["services", brandId] });
      toast.success(
        r.deleted
          ? "Service deleted"
          : "This service has appointment history and can't be deleted, but has been deactivated instead.",
      );
      onClose();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {mode === "create" ? "Add service" : isOwner ? "Edit service" : "Service details"}
          </DialogTitle>
          <DialogDescription>
            {isOwner
              ? "Service catalog is shared brand-wide. Set optional per-location prices below."
              : "Read-only view. Only the Owner can edit services or pricing."}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-2">
          <div className="grid gap-2">
            <Label htmlFor="svc-name">Name *</Label>
            <Input
              id="svc-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={!isOwner}
              dir="auto"
            />
          </div>

          <div className="grid gap-2 md:grid-cols-2">
            <div className="grid gap-2">
              <Label>Category</Label>
              <Select
                value={category || "none"}
                onValueChange={(v) => setCategory(v === "none" ? "" : v)}
                disabled={!isOwner}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Choose a category" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">—</SelectItem>
                  {CATEGORIES.map((c) => (
                    <SelectItem key={c} value={c}>
                      {c}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="svc-duration">Duration (minutes) *</Label>
              <Input
                id="svc-duration"
                type="number"
                min={5}
                step={5}
                value={duration}
                onChange={(e) => setDuration(Number(e.target.value))}
                disabled={!isOwner}
              />
            </div>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="svc-desc">Description</Label>
            <Textarea
              id="svc-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              disabled={!isOwner}
              dir="auto"
              rows={3}
            />
          </div>

          <div className="grid gap-2 md:grid-cols-3">
            <div className="grid gap-2 md:col-span-2">
              <Label htmlFor="svc-price">Default price *</Label>
              <Input
                id="svc-price"
                type="number"
                min={0}
                step="0.01"
                value={defaultPrice}
                onChange={(e) => setDefaultPrice(Number(e.target.value))}
                disabled={!isOwner}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="svc-currency">Currency</Label>
              <Input
                id="svc-currency"
                value={currency}
                onChange={(e) => setCurrency(e.target.value.toUpperCase())}
                maxLength={4}
                disabled={!isOwner}
              />
            </div>
          </div>

          {isOwner && (
            <label className="flex items-center gap-2 text-sm">
              <Switch checked={isActive} onCheckedChange={setIsActive} />
              <span>
                {isActive ? "Active" : "Inactive"}
                <span className="ml-2 text-xs text-muted-foreground">
                  Inactive services are hidden from the booking dropdown.
                </span>
              </span>
            </label>
          )}

          {mode === "edit" && service && (
            <div className="mt-2 rounded-md border border-border bg-muted/30 p-4">
              <div className="mb-1 flex items-baseline justify-between gap-2">
                <h3 className="text-sm font-semibold">Per-location pricing</h3>
                <span className="text-xs text-muted-foreground">
                  Internal pricing — not shown to clients
                </span>
              </div>
              <p className="mb-3 text-xs text-muted-foreground">
                Leave blank to use the default price at that location.
              </p>
              <OverridesTable
                service={service}
                locations={locations}
                overrides={overridesQ.data ?? []}
                isOwner={isOwner}
                managerLocationId={managerLocationId}
              />
            </div>
          )}
        </div>

        <DialogFooter className="gap-2 sm:justify-between">
          <div>
            {mode === "edit" && isOwner && (
              <Button
                variant="ghost"
                className="text-destructive hover:text-destructive"
                onClick={() => deactivate.mutate()}
                disabled={deactivate.isPending}
              >
                <Ban className="mr-2 h-4 w-4" />
                {service?.is_active ? "Deactivate / delete" : "Delete"}
              </Button>
            )}
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={onClose}>
              {isOwner ? "Cancel" : "Close"}
            </Button>
            {isOwner && (
              <Button onClick={() => save.mutate()} disabled={save.isPending}>
                {save.isPending ? "Saving…" : "Save"}
              </Button>
            )}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function OverridesTable({
  service,
  locations,
  overrides,
  isOwner,
  managerLocationId,
}: {
  service: ServiceRow;
  locations: LocationRow[];
  overrides: OverrideRow[];
  isOwner: boolean;
  managerLocationId: string | null;
}) {
  const qc = useQueryClient();
  const map = useMemo(() => {
    const m = new Map<string, OverrideRow>();
    overrides.forEach((o) => m.set(o.location_id, o));
    return m;
  }, [overrides]);

  const visibleLocations = isOwner
    ? locations
    : locations.filter((l) => l.id === managerLocationId);

  const upsert = useMutation({
    mutationFn: async ({
      locationId,
      price,
    }: {
      locationId: string;
      price: string;
    }) => {
      const trimmed = price.trim();
      const existing = map.get(locationId);
      if (trimmed === "") {
        if (existing) {
          const { error } = await supabase
            .from("service_location_prices")
            .delete()
            .eq("id", existing.id);
          if (error) throw error;
        }
        return;
      }
      const num = Number(trimmed);
      if (Number.isNaN(num) || num < 0) throw new Error("Invalid price");
      if (num === service.default_price) {
        if (existing) {
          const { error } = await supabase
            .from("service_location_prices")
            .delete()
            .eq("id", existing.id);
          if (error) throw error;
        }
        return;
      }
      if (existing) {
        const { error } = await supabase
          .from("service_location_prices")
          .update({ price: num, currency: service.currency })
          .eq("id", existing.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("service_location_prices").insert({
          service_id: service.id,
          location_id: locationId,
          price: num,
          currency: service.currency,
        });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["service_overrides", service.id] });
      toast.success("Price updated");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Location</TableHead>
          <TableHead className="w-[180px]">Effective price</TableHead>
          {isOwner && <TableHead className="w-[200px]">Override</TableHead>}
        </TableRow>
      </TableHeader>
      <TableBody>
        {visibleLocations.length === 0 ? (
          <TableRow>
            <TableCell
              colSpan={isOwner ? 3 : 2}
              className="py-4 text-center text-sm text-muted-foreground"
            >
              No locations yet.
            </TableCell>
          </TableRow>
        ) : (
          visibleLocations.map((loc) => {
            const existing = map.get(loc.id);
            const effective = existing?.price ?? service.default_price;
            return (
              <OverrideRow
                key={loc.id}
                location={loc}
                effective={effective}
                currency={service.currency}
                existingPrice={existing?.price ?? null}
                isOwner={isOwner}
                onSave={(price) =>
                  upsert.mutate({ locationId: loc.id, price })
                }
              />
            );
          })
        )}
      </TableBody>
    </Table>
  );
}

function OverrideRow({
  location,
  effective,
  currency,
  existingPrice,
  isOwner,
  onSave,
}: {
  location: LocationRow;
  effective: number;
  currency: string;
  existingPrice: number | null;
  isOwner: boolean;
  onSave: (price: string) => void;
}) {
  const [value, setValue] = useState(
    existingPrice != null ? String(existingPrice) : "",
  );
  return (
    <TableRow>
      <TableCell className="font-medium">{location.name}</TableCell>
      <TableCell className="font-mono">
        {effective.toFixed(2)} {currency}
        {existingPrice != null && (
          <span className="ml-2 text-xs text-muted-foreground">(override)</span>
        )}
      </TableCell>
      {isOwner && (
        <TableCell>
          <div className="flex gap-2">
            <Input
              type="number"
              min={0}
              step="0.01"
              placeholder="Use default"
              value={value}
              onChange={(e) => setValue(e.target.value)}
            />
            <Button
              size="sm"
              variant="outline"
              onClick={() => onSave(value)}
              disabled={
                value === (existingPrice != null ? String(existingPrice) : "")
              }
            >
              Save
            </Button>
          </div>
        </TableCell>
      )}
    </TableRow>
  );
}
