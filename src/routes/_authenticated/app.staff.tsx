import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2, MailPlus } from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { useTenant, type AppRole } from "@/hooks/use-tenant";
import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
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
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
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

export const Route = createFileRoute("/_authenticated/app/staff")({
  head: () => ({
    meta: [{ title: "Staff — Lumen Salon Suite" }, { name: "robots", content: "noindex" }],
  }),
  component: StaffPage,
});

type StaffRow = {
  id: string;
  user_id: string | null;
  role: AppRole;
  brand_id: string;
  location_id: string | null;
  invited_email: string | null;
  full_name: string | null;
  email: string | null;
  location_name: string | null;
};

type LocationRow = { id: string; name: string };

const ROLE_LABEL: Record<AppRole, string> = {
  owner: "Owner",
  manager: "Manager",
  receptionist: "Receptionist",
  staff: "Staff",
};

function RoleBadge({ role }: { role: AppRole }) {
  const cls =
    role === "owner"
      ? "bg-accent/20 text-accent-foreground border-accent/40"
      : role === "manager"
        ? "bg-primary/10 text-primary border-primary/20"
        : role === "receptionist"
          ? "bg-secondary text-secondary-foreground"
          : "bg-muted text-muted-foreground";
  return <Badge variant="outline" className={cls}>{ROLE_LABEL[role]}</Badge>;
}

function StaffPage() {
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
  if (role !== "owner" && role !== "manager") {
    return (
      <AppShell>
        <div className="p-8">
          <h1 className="font-display text-2xl font-semibold">Not available</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            You don't have access to team management.
          </p>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <StaffContent />
    </AppShell>
  );
}

function StaffContent() {
  const tenant = useTenant();
  const queryClient = useQueryClient();
  const brandId = tenant.data!.brandId!;
  const myRole = tenant.data!.primaryRole!;
  const myLocationId = tenant.data!.locationId;
  const myUserId = tenant.data!.userId;

  const [inviteOpen, setInviteOpen] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState<StaffRow | null>(null);

  const { data: brand } = useQuery({
    queryKey: ["brand", brandId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("brands")
        .select("id, name, plan, max_staff_accounts")
        .eq("id", brandId)
        .single();
      if (error) throw error;
      return data;
    },
  });

  const { data: locations = [] } = useQuery<LocationRow[]>({
    queryKey: ["locations", brandId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("locations")
        .select("id, name")
        .eq("brand_id", brandId)
        .order("name");
      if (error) throw error;
      return data;
    },
  });

  const { data: staff = [], isLoading } = useQuery<StaffRow[]>({
    queryKey: ["staff", brandId],
    queryFn: async () => {
      const { data: rolesData, error } = await supabase
        .from("user_roles")
        .select("id, user_id, role, brand_id, location_id, invited_email")
        .eq("brand_id", brandId);
      if (error) throw error;

      const rows = rolesData ?? [];
      const userIds = rows.map((r) => r.user_id).filter((x): x is string => !!x);
      const locIds = rows.map((r) => r.location_id).filter((x): x is string => !!x);

      const [profilesRes, locsRes] = await Promise.all([
        userIds.length
          ? supabase.from("profiles").select("id, full_name, email").in("id", userIds)
          : Promise.resolve({ data: [], error: null }),
        locIds.length
          ? supabase.from("locations").select("id, name").in("id", locIds)
          : Promise.resolve({ data: [], error: null }),
      ]);

      const profileMap = new Map(
        ((profilesRes.data as Array<{ id: string; full_name: string | null; email: string | null }>) ?? [])
          .map((p) => [p.id, p]),
      );
      const locMap = new Map(
        ((locsRes.data as Array<{ id: string; name: string }>) ?? []).map((l) => [l.id, l.name]),
      );

      return rows.map((r) => {
        const p = r.user_id ? profileMap.get(r.user_id) : undefined;
        return {
          id: r.id,
          user_id: r.user_id,
          role: r.role as AppRole,
          brand_id: r.brand_id,
          location_id: r.location_id,
          invited_email: r.invited_email ?? null,
          full_name: p?.full_name ?? null,
          email: p?.email ?? r.invited_email ?? null,
          location_name: r.location_id ? locMap.get(r.location_id) ?? null : null,
        } satisfies StaffRow;
      });
    },
  });

  // Manager only sees staff at their location + themselves
  const visibleStaff = useMemo(() => {
    if (myRole === "owner") return staff;
    return staff.filter(
      (s) => s.location_id === myLocationId || s.user_id === myUserId,
    );
  }, [staff, myRole, myLocationId, myUserId]);

  const activeCount = staff.length;
  const maxStaff = brand?.max_staff_accounts ?? 0;
  const atLimit = activeCount >= maxStaff;

  const removeMutation = useMutation({
    mutationFn: async (row: StaffRow) => {
      const { error } = await supabase.from("user_roles").delete().eq("id", row.id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Removed");
      queryClient.invalidateQueries({ queryKey: ["staff", brandId] });
    },
    onError: (err) => {
      toast.error("Could not remove", {
        description: err instanceof Error ? err.message : "Please try again.",
      });
    },
  });

  function canRemove(row: StaffRow): boolean {
    if (row.user_id === myUserId) return false; // never self
    if (myRole === "owner") return row.role !== "owner" || staff.filter((s) => s.role === "owner").length > 1;
    if (myRole === "manager") {
      return (
        (row.role === "receptionist" || row.role === "staff") &&
        row.location_id === myLocationId
      );
    }
    return false;
  }

  return (
    <div className="mx-auto max-w-6xl px-6 py-10">
      <div className="mb-8 flex items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl font-semibold tracking-tight">Staff</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {myRole === "owner"
              ? "Everyone on your brand across every location."
              : "Your location's team."}
          </p>
          {brand && (
            <p className="mt-2 text-xs text-muted-foreground">
              {activeCount} of {maxStaff} seats used on the{" "}
              <span className="capitalize">{brand.plan}</span> plan.
            </p>
          )}
        </div>
        <Button onClick={() => setInviteOpen(true)} disabled={atLimit}>
          <Plus className="mr-2 h-4 w-4" /> Invite staff
        </Button>
      </div>

      {atLimit && (
        <div className="mb-6 rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
          You've reached your <span className="capitalize">{brand?.plan}</span> plan's staff limit of{" "}
          {maxStaff}. Remove a member or upgrade to add more.
        </div>
      )}

      <Card className="overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Email</TableHead>
              <TableHead>Role</TableHead>
              <TableHead>Location</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="w-16" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading && (
              <TableRow>
                <TableCell colSpan={6}>
                  <Skeleton className="h-8 w-full" />
                </TableCell>
              </TableRow>
            )}
            {!isLoading && visibleStaff.length === 0 && (
              <TableRow>
                <TableCell colSpan={6} className="py-10 text-center text-sm text-muted-foreground">
                  No team members yet. Invite your first staff to get started.
                </TableCell>
              </TableRow>
            )}
            {visibleStaff.map((row) => {
              const pending = !row.user_id;
              return (
                <TableRow key={row.id}>
                  <TableCell className="font-medium">
                    {row.full_name || (pending ? <span className="text-muted-foreground italic">Awaiting sign-up</span> : "—")}
                    {row.user_id === myUserId && (
                      <span className="ml-2 text-xs text-muted-foreground">(you)</span>
                    )}
                  </TableCell>
                  <TableCell className="text-muted-foreground">{row.email ?? "—"}</TableCell>
                  <TableCell><RoleBadge role={row.role} /></TableCell>
                  <TableCell className="text-muted-foreground">
                    {row.role === "owner" ? "All locations" : row.location_name ?? "—"}
                  </TableCell>
                  <TableCell>
                    {pending ? (
                      <Badge variant="outline" className="border-amber-400 bg-amber-50 text-amber-900">
                        Pending
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="border-emerald-400 bg-emerald-50 text-emerald-900">
                        Active
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell>
                    {canRemove(row) && (
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => setConfirmRemove(row)}
                        aria-label="Remove"
                      >
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </Card>

      <InviteDialog
        open={inviteOpen}
        onOpenChange={setInviteOpen}
        brandId={brandId}
        locations={locations}
        myRole={myRole}
        myLocationId={myLocationId}
        atLimit={atLimit}
        maxStaff={maxStaff}
        planLabel={brand?.plan ?? ""}
        onDone={() => queryClient.invalidateQueries({ queryKey: ["staff", brandId] })}
      />

      <AlertDialog
        open={!!confirmRemove}
        onOpenChange={(v) => !v && setConfirmRemove(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove team member?</AlertDialogTitle>
            <AlertDialogDescription>
              {confirmRemove?.full_name || confirmRemove?.email || "This person"} will lose access
              immediately. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                if (confirmRemove) removeMutation.mutate(confirmRemove);
                setConfirmRemove(null);
              }}
            >
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function InviteDialog({
  open,
  onOpenChange,
  brandId,
  locations,
  myRole,
  myLocationId,
  atLimit,
  maxStaff,
  planLabel,
  onDone,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  brandId: string;
  locations: LocationRow[];
  myRole: AppRole;
  myLocationId: string | null;
  atLimit: boolean;
  maxStaff: number;
  planLabel: string;
  onDone: () => void;
}) {
  const roleOptions: AppRole[] =
    myRole === "owner" ? ["manager", "receptionist", "staff"] : ["receptionist", "staff"];

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<AppRole>(roleOptions[0]);
  const [locationId, setLocationId] = useState<string>(
    myRole === "manager" ? (myLocationId ?? "") : locations[0]?.id ?? "",
  );
  const [submitting, setSubmitting] = useState(false);

  async function submit() {
    if (!email.trim()) return;
    const finalRole = role;
    const finalLocationId =
      finalRole === "manager"
        ? locationId || null
        : myRole === "manager"
          ? myLocationId
          : locationId || null;

    if (finalRole !== "owner" && !finalLocationId) {
      toast.error("Pick a location for this role.");
      return;
    }

    setSubmitting(true);
    try {
      const { error } = await supabase.from("user_roles").insert({
        brand_id: brandId,
        role: finalRole,
        location_id: finalLocationId,
        invited_email: email.trim().toLowerCase(),
        user_id: null,
      });
      if (error) {
        if (error.message.toLowerCase().includes("staff limit")) {
          toast.error("Plan limit reached", { description: error.message });
        } else if (error.code === "23505") {
          toast.error("Already invited", {
            description: "There's already a pending invite for that email.",
          });
        } else {
          throw error;
        }
        return;
      }

      // Store optional name hint in profiles once the user signs up we'll overwrite.
      // For now, just show success with the invite email.
      toast.success("Invite created", {
        description: `Ask ${name || email} to sign up at your Lumen URL with this email.`,
      });
      onDone();
      onOpenChange(false);
      setName("");
      setEmail("");
    } catch (err) {
      toast.error("Could not invite", {
        description: err instanceof Error ? err.message : "Please try again.",
      });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="font-display text-xl">Invite staff</DialogTitle>
          <DialogDescription>
            They'll be added to your team as soon as they sign up with this email.
          </DialogDescription>
        </DialogHeader>

        {atLimit ? (
          <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
            You've reached your <span className="capitalize">{planLabel}</span> plan's staff limit of{" "}
            {maxStaff}. Upgrade to add more.
          </div>
        ) : (
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="inv-name">Name (optional)</Label>
              <Input
                id="inv-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Full name"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="inv-email">Email</Label>
              <Input
                id="inv-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="them@example.com"
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label>Role</Label>
              <Select value={role} onValueChange={(v) => setRole(v as AppRole)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {roleOptions.map((r) => (
                    <SelectItem key={r} value={r}>{ROLE_LABEL[r]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {myRole === "owner" && (
              <div className="space-y-1.5">
                <Label>Location</Label>
                <Select value={locationId} onValueChange={setLocationId}>
                  <SelectTrigger><SelectValue placeholder="Choose location" /></SelectTrigger>
                  <SelectContent>
                    {locations.map((l) => (
                      <SelectItem key={l.id} value={l.id}>{l.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            {myRole === "manager" && (
              <p className="text-xs text-muted-foreground">
                Invite will be assigned to your location.
              </p>
            )}
          </div>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={submitting || atLimit || !email.trim()}>
            <MailPlus className="mr-2 h-4 w-4" />
            {submitting ? "Creating…" : "Create invite"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
