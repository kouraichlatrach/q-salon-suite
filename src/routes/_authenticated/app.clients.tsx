import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { format, parseISO } from "date-fns";
import { Plus, Search, ArrowUpDown } from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/hooks/use-tenant";
import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export const Route = createFileRoute("/_authenticated/app/clients")({
  head: () => ({
    meta: [{ title: "Clients — Lumen Salon Suite" }, { name: "robots", content: "noindex" }],
  }),
  component: ClientsPage,
});

type ClientRow = {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  notes: string | null;
  no_show_count: number;
  updated_at: string;
  last_visit?: string | null;
};

type SortKey = "name" | "last_visit" | "no_show_count";

function NoShowBadge({ count }: { count: number }) {
  if (count === 0) {
    return <Badge variant="secondary" className="font-mono">0</Badge>;
  }
  if (count <= 2) {
    return (
      <Badge className="border-transparent bg-amber-100 text-amber-900 hover:bg-amber-100 font-mono">
        {count}
      </Badge>
    );
  }
  return (
    <Badge className="border-transparent bg-red-100 text-red-900 hover:bg-red-100 font-mono">
      {count}
    </Badge>
  );
}

function ClientsPage() {
  const tenant = useTenant();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<SortKey>("name");
  const [editing, setEditing] = useState<ClientRow | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);

  const role = tenant.data?.primaryRole;
  const brandId = tenant.data?.brandId ?? null;
  const canWrite = role === "owner" || role === "manager" || role === "receptionist";
  const isStaff = role === "staff";

  const clientsQuery = useQuery({
    enabled: !!brandId && !isStaff,
    queryKey: ["clients", brandId],
    queryFn: async (): Promise<ClientRow[]> => {
      const { data: clients, error } = await supabase
        .from("clients")
        .select("id, name, phone, email, notes, no_show_count, updated_at")
        .eq("brand_id", brandId!)
        .order("name", { ascending: true });
      if (error) throw error;

      // Fetch last visit dates (completed appointments) for these clients
      const ids = (clients ?? []).map((c) => c.id);
      let lastVisitMap = new Map<string, string>();
      if (ids.length) {
        const { data: appts } = await supabase
          .from("appointments")
          .select("client_id, starts_at, status")
          .in("client_id", ids)
          .eq("status", "completed")
          .order("starts_at", { ascending: false });
        for (const a of appts ?? []) {
          if (!lastVisitMap.has(a.client_id)) {
            lastVisitMap.set(a.client_id, a.starts_at);
          }
        }
      }

      return (clients ?? []).map((c) => ({
        ...c,
        last_visit: lastVisitMap.get(c.id) ?? null,
      }));
    },
  });

  const filteredSorted = useMemo(() => {
    const list = clientsQuery.data ?? [];
    const q = search.trim().toLowerCase();
    const filtered = q
      ? list.filter(
          (c) =>
            c.name.toLowerCase().includes(q) ||
            (c.phone ?? "").toLowerCase().includes(q),
        )
      : list;
    const sorted = [...filtered].sort((a, b) => {
      if (sort === "name") return a.name.localeCompare(b.name);
      if (sort === "no_show_count") return b.no_show_count - a.no_show_count;
      // last_visit desc, nulls last
      const av = a.last_visit ? new Date(a.last_visit).getTime() : -Infinity;
      const bv = b.last_visit ? new Date(b.last_visit).getTime() : -Infinity;
      return bv - av;
    });
    return sorted;
  }, [clientsQuery.data, search, sort]);

  const deleteMut = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("clients").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["clients", brandId] });
    },
  });

  if (tenant.isLoading) {
    return (
      <div className="p-8">
        <Skeleton className="h-10 w-64 mb-4" />
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }

  if (isStaff) {
    return (
      <div className="p-8">
        <h1 className="font-display text-2xl font-semibold">Not available</h1>
        <p className="text-muted-foreground mt-2 text-sm">
          The client list isn't available for your role. You can view clients from your own appointments.
        </p>
      </div>
    );
  }

  return (
    <div className="p-6 md:p-10">
      <div className="flex flex-wrap items-end justify-between gap-4 mb-6">
        <div>
          <h1 className="font-display text-3xl font-semibold tracking-tight">Clients</h1>
          <p className="text-sm text-muted-foreground mt-1">
            All clients across your brand's locations.
          </p>
        </div>
        {canWrite && (
          <Button
            onClick={() => {
              setEditing(null);
              setDialogOpen(true);
            }}
          >
            <Plus className="h-4 w-4 mr-2" />
            Add client
          </Button>
        )}
      </div>

      <div className="flex flex-wrap gap-3 mb-4">
        <div className="relative flex-1 min-w-[240px] max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name or phone"
            className="pl-9"
          />
        </div>
        <Select value={sort} onValueChange={(v) => setSort(v as SortKey)}>
          <SelectTrigger className="w-[200px]">
            <ArrowUpDown className="h-4 w-4 mr-2" />
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="name">Sort: Name (A–Z)</SelectItem>
            <SelectItem value="last_visit">Sort: Last visit</SelectItem>
            <SelectItem value="no_show_count">Sort: No-shows</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <Card className="overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Phone</TableHead>
              <TableHead>Email</TableHead>
              <TableHead className="text-center">No-shows</TableHead>
              <TableHead>Last visit</TableHead>
              <TableHead className="w-[80px]" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {clientsQuery.isLoading ? (
              <TableRow>
                <TableCell colSpan={6} className="py-12 text-center text-muted-foreground">
                  Loading…
                </TableCell>
              </TableRow>
            ) : filteredSorted.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="py-16 text-center">
                  <div className="font-medium">No clients yet</div>
                  <p className="text-sm text-muted-foreground mt-1">
                    {search ? "Try a different search." : "Add your first client to get started."}
                  </p>
                </TableCell>
              </TableRow>
            ) : (
              filteredSorted.map((c) => (
                <TableRow key={c.id} className="group">
                  <TableCell className="font-medium">
                    <Link
                      to="/app/clients/$id"
                      params={{ id: c.id }}
                      className="hover:text-accent-foreground hover:underline"
                    >
                      {c.name}
                    </Link>
                  </TableCell>
                  <TableCell className="text-muted-foreground">{c.phone || "—"}</TableCell>
                  <TableCell className="text-muted-foreground">{c.email || "—"}</TableCell>
                  <TableCell className="text-center">
                    <NoShowBadge count={c.no_show_count} />
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {c.last_visit ? format(parseISO(c.last_visit), "d MMM yyyy") : "—"}
                  </TableCell>
                  <TableCell className="text-right">
                    {canWrite && (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          setEditing(c);
                          setDialogOpen(true);
                        }}
                      >
                        Edit
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </Card>

      {canWrite && brandId && (
        <ClientFormDialog
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          brandId={brandId}
          client={editing}
          onDelete={
            editing
              ? () => {
                  if (confirm("Delete this client? This cannot be undone.")) {
                    deleteMut.mutate(editing.id, {
                      onSuccess: () => {
                        toast.success("Client deleted");
                        setDialogOpen(false);
                      },
                      onError: (e) =>
                        toast.error("Delete failed", {
                          description: e instanceof Error ? e.message : undefined,
                        }),
                    });
                  }
                }
              : undefined
          }
        />
      )}
    </div>
  );
}

export function ClientFormDialog({
  open,
  onOpenChange,
  brandId,
  client,
  onDelete,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  brandId: string;
  client: ClientRow | null;
  onDelete?: () => void;
}) {
  const queryClient = useQueryClient();
  const [name, setName] = useState(client?.name ?? "");
  const [phone, setPhone] = useState(client?.phone ?? "");
  const [email, setEmail] = useState(client?.email ?? "");
  const [notes, setNotes] = useState(client?.notes ?? "");

  // Reset fields when opening for different client
  useMemo(() => {
    if (open) {
      setName(client?.name ?? "");
      setPhone(client?.phone ?? "");
      setEmail(client?.email ?? "");
      setNotes(client?.notes ?? "");
    }
  }, [open, client]);

  const saveMut = useMutation({
    mutationFn: async () => {
      const payload = {
        brand_id: brandId,
        name: name.trim(),
        phone: phone.trim() || null,
        email: email.trim() || null,
        notes: notes.trim() || null,
      };
      if (client) {
        const { error } = await supabase.from("clients").update(payload).eq("id", client.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("clients").insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      toast.success(client ? "Client updated" : "Client added");
      queryClient.invalidateQueries({ queryKey: ["clients", brandId] });
      queryClient.invalidateQueries({ queryKey: ["client", client?.id] });
      onOpenChange(false);
    },
    onError: (e) =>
      toast.error("Save failed", {
        description: e instanceof Error ? e.message : undefined,
      }),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle className="font-display text-2xl">
            {client ? "Edit client" : "Add client"}
          </DialogTitle>
          <DialogDescription>
            Client details are shared across all your locations.
          </DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!name.trim()) return;
            saveMut.mutate();
          }}
          className="space-y-4"
        >
          <div className="space-y-1.5">
            <Label htmlFor="cname">Name *</Label>
            <Input
              id="cname"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              autoFocus
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="cphone">Phone</Label>
              <Input
                id="cphone"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="+974 ..."
                inputMode="tel"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="cemail">Email</Label>
              <Input
                id="cemail"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="cnotes">Notes</Label>
            <Textarea
              id="cnotes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Allergies, preferences, hair history…"
              rows={5}
              dir="auto"
              lang="und"
              style={{ fontFamily: "var(--font-body, inherit)" }}
            />
            <p className="text-xs text-muted-foreground">
              Arabic script is supported and will display right-to-left automatically.
            </p>
          </div>
          <DialogFooter className="gap-2 sm:justify-between">
            {onDelete ? (
              <Button
                type="button"
                variant="ghost"
                className="text-destructive hover:text-destructive"
                onClick={onDelete}
              >
                Delete
              </Button>
            ) : (
              <span />
            )}
            <div className="flex gap-2">
              <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={saveMut.isPending || !name.trim()}>
                {saveMut.isPending ? "Saving…" : "Save"}
              </Button>
            </div>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
