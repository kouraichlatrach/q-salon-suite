import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Pencil } from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/hooks/use-tenant";
import { AppShell } from "@/components/app-shell";
import { errorMessage } from "@/lib/error-message";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export const Route = createFileRoute("/_authenticated/app/locations")({
  head: () => ({
    meta: [{ title: "Locations — Q-Salon Suite" }, { name: "robots", content: "noindex" }],
  }),
  component: LocationsPage,
});

type LocationRow = {
  id: string;
  name: string;
  address: string | null;
  phone: string | null;
  staff_count: number;
};

function LocationsPage() {
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
            Only the salon owner can manage locations.
          </p>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <LocationsContent />
    </AppShell>
  );
}

function LocationsContent() {
  const tenant = useTenant();
  const brandId = tenant.data!.brandId!;
  const queryClient = useQueryClient();

  const [editing, setEditing] = useState<LocationRow | null>(null);
  const [creating, setCreating] = useState(false);

  const { data: brand } = useQuery({
    queryKey: ["brand", brandId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("brands")
        .select("id, name, plan, max_locations")
        .eq("id", brandId)
        .single();
      if (error) throw error;
      return data;
    },
  });

  const { data: rows = [], isLoading } = useQuery<LocationRow[]>({
    queryKey: ["locations-with-staff", brandId],
    queryFn: async () => {
      const { data: locs, error } = await supabase
        .from("locations")
        .select("id, name, address, phone")
        .eq("brand_id", brandId)
        .order("name");
      if (error) throw error;

      const { data: roles, error: rolesErr } = await supabase
        .from("user_roles")
        .select("location_id, role")
        .eq("brand_id", brandId);
      if (rolesErr) throw rolesErr;

      const counts = new Map<string, number>();
      for (const r of roles ?? []) {
        if (r.location_id && r.role !== "owner") {
          counts.set(r.location_id, (counts.get(r.location_id) ?? 0) + 1);
        }
      }
      return (locs ?? []).map((l) => ({
        ...l,
        staff_count: counts.get(l.id) ?? 0,
      }));
    },
  });

  const currentCount = rows.length;
  const maxLocations = brand?.max_locations ?? 0;
  const atLimit = currentCount >= maxLocations;

  return (
    <div className="mx-auto max-w-6xl px-6 py-10">
      <div className="mb-8 flex items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl font-semibold tracking-tight">Locations</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            The salons under your brand.
          </p>
          {brand && (
            <p className="mt-2 text-xs text-muted-foreground">
              {currentCount} of {maxLocations} used on the{" "}
              <span className="capitalize">{brand.plan}</span> plan.
            </p>
          )}
        </div>
        <div className="flex flex-col items-end gap-1">
          <Button onClick={() => setCreating(true)} disabled={atLimit}>
            <Plus className="mr-2 h-4 w-4" /> Add location
          </Button>
          {atLimit && (
            <span className="text-xs text-muted-foreground">
              You've reached your <span className="capitalize">{brand?.plan}</span> plan's location limit. Upgrade to add more.
            </span>
          )}
        </div>
      </div>

      <Card className="overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Address</TableHead>
              <TableHead>Phone</TableHead>
              <TableHead>Staff</TableHead>
              <TableHead className="w-16" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading && (
              <TableRow>
                <TableCell colSpan={5}>
                  <Skeleton className="h-8 w-full" />
                </TableCell>
              </TableRow>
            )}
            {!isLoading && rows.length === 0 && (
              <TableRow>
                <TableCell colSpan={5} className="py-10 text-center text-sm text-muted-foreground">
                  No locations yet.
                </TableCell>
              </TableRow>
            )}
            {rows.map((row) => (
              <TableRow key={row.id}>
                <TableCell className="font-medium">{row.name}</TableCell>
                <TableCell className="text-muted-foreground" dir="auto">{row.address ?? "—"}</TableCell>
                <TableCell className="text-muted-foreground">{row.phone ?? "—"}</TableCell>
                <TableCell className="text-muted-foreground">{row.staff_count}</TableCell>
                <TableCell>
                  <div className="flex justify-end">
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => setEditing(row)}
                      aria-label="Edit location"
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>

      <LocationDialog
        open={creating}
        onOpenChange={setCreating}
        brandId={brandId}
        onDone={() =>
          queryClient.invalidateQueries({ queryKey: ["locations-with-staff", brandId] })
        }
      />
      <LocationDialog
        open={!!editing}
        onOpenChange={(v) => !v && setEditing(null)}
        brandId={brandId}
        initial={editing ?? undefined}
        onDone={() =>
          queryClient.invalidateQueries({ queryKey: ["locations-with-staff", brandId] })
        }
      />
    </div>
  );
}

function LocationDialog({
  open,
  onOpenChange,
  brandId,
  initial,
  onDone,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  brandId: string;
  initial?: LocationRow;
  onDone: () => void;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [address, setAddress] = useState(initial?.address ?? "");
  const [phone, setPhone] = useState(initial?.phone ?? "");
  const [submitting, setSubmitting] = useState(false);
  const isEdit = !!initial;

  // Reset when reopening with different initial
  const key = initial?.id ?? "new";
  const [lastKey, setLastKey] = useState(key);
  if (open && lastKey !== key) {
    setLastKey(key);
    setName(initial?.name ?? "");
    setAddress(initial?.address ?? "");
    setPhone(initial?.phone ?? "");
  }

  async function submit() {
    const trimmed = name.trim();
    if (!trimmed) {
      toast.error("Name is required.");
      return;
    }
    setSubmitting(true);
    try {
      if (isEdit && initial) {
        const { error } = await supabase
          .from("locations")
          .update({
            name: trimmed,
            address: address.trim() || null,
            phone: phone.trim() || null,
          })
          .eq("id", initial.id);
        if (error) throw error;
        toast.success("Location updated");
      } else {
        const { error } = await supabase.from("locations").insert({
          brand_id: brandId,
          name: trimmed,
          address: address.trim() || null,
          phone: phone.trim() || null,
        });
        if (error) {
          if (error.message.toLowerCase().includes("location limit")) {
            toast.error("Plan limit reached", { description: error.message });
          } else {
            throw error;
          }
          return;
        }
        toast.success("Location added");
      }
      onDone();
      onOpenChange(false);
    } catch (err) {
      toast.error(isEdit ? "Could not update" : "Could not add", {
        description: errorMessage(err, "Please try again."),
      });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit location" : "Add location"}</DialogTitle>
          <DialogDescription>
            {isEdit ? "Update this location's details." : "Create a new location under your brand."}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div>
            <Label htmlFor="loc-name">Name</Label>
            <Input id="loc-name" value={name} onChange={(e) => setName(e.target.value)} dir="auto" />
          </div>
          <div>
            <Label htmlFor="loc-address">Address</Label>
            <Input
              id="loc-address"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              dir="auto"
            />
          </div>
          <div>
            <Label htmlFor="loc-phone">Phone</Label>
            <Input id="loc-phone" value={phone} onChange={(e) => setPhone(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={submitting}>
            {submitting ? "Saving…" : isEdit ? "Save" : "Add location"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
