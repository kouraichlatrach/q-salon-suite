import { errorMessage } from "@/lib/error-message";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { format, parseISO } from "date-fns";
import { ArrowLeft, Mail, Phone, Pencil, Save, X } from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/hooks/use-tenant";
import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";

export const Route = createFileRoute("/_authenticated/app/clients/$id")({
  head: () => ({
    meta: [{ title: "Client — Q-Salon Suite" }, { name: "robots", content: "noindex" }],
  }),
  component: ClientDetailPage,
});

const STATUS_LABEL: Record<string, string> = {
  scheduled: "Scheduled",
  confirmed: "Confirmed",
  in_progress: "In progress",
  completed: "Completed",
  cancelled: "Cancelled",
  no_show: "No-show",
};

function ClientDetailPage() {
  const { id } = Route.useParams();
  const navigate = useNavigate();
  const tenant = useTenant();
  const queryClient = useQueryClient();
  const role = tenant.data?.primaryRole;
  const canWrite = role === "owner" || role === "manager" || role === "receptionist";

  const [editingNotes, setEditingNotes] = useState(false);
  const [notesDraft, setNotesDraft] = useState("");

  const clientQuery = useQuery({
    enabled: !!id,
    queryKey: ["client", id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("clients")
        .select("id, brand_id, name, phone, email, notes, no_show_count, created_at")
        .eq("id", id)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const historyQuery = useQuery({
    enabled: !!id,
    queryKey: ["client-history", id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("appointments")
        .select(
          "id, starts_at, ends_at, status, price, currency, service:services(name), location:locations(name), service_records(id, service_performed, formula_notes, notes)",
        )
        .eq("client_id", id)
        .order("starts_at", { ascending: false })
        .limit(100);
      if (error) throw error;
      return data ?? [];
    },
  });

  const notesMut = useMutation({
    mutationFn: async (notes: string) => {
      const { error } = await supabase
        .from("clients")
        .update({ notes: notes.trim() || null })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Notes updated");
      queryClient.invalidateQueries({ queryKey: ["client", id] });
      setEditingNotes(false);
    },
    onError: (e) =>
      toast.error("Save failed", {
        description: errorMessage(e),
      }),
  });

  const noShowBadge = useMemo(() => {
    const count = clientQuery.data?.no_show_count ?? 0;
    if (count === 0)
      return <Badge variant="secondary">0 no-shows</Badge>;
    if (count <= 2)
      return (
        <Badge className="border-transparent bg-amber-100 text-amber-900 hover:bg-amber-100">
          {count} no-show{count > 1 ? "s" : ""}
        </Badge>
      );
    return (
      <Badge className="border-transparent bg-red-100 text-red-900 hover:bg-red-100">
        {count} no-shows
      </Badge>
    );
  }, [clientQuery.data?.no_show_count]);

  if (tenant.isLoading || clientQuery.isLoading) {
    return (
      <AppShell>
        <div className="p-8">
          <Skeleton className="h-10 w-64 mb-4" />
          <Skeleton className="h-40 w-full" />
        </div>
      </AppShell>
    );
  }

  if (!clientQuery.data) {
    return (
      <AppShell>
        <div className="p-8">
          <Button variant="ghost" onClick={() => navigate({ to: "/app/clients" })}>
            <ArrowLeft className="h-4 w-4 mr-2" /> Back
          </Button>
          <div className="mt-6 text-center">
            <h1 className="font-display text-2xl font-semibold">Client not found</h1>
            <p className="text-sm text-muted-foreground mt-1">
              This client may have been removed or you don't have access to it.
            </p>
          </div>
        </div>
      </AppShell>
    );
  }

  const client = clientQuery.data;

  return (
    <AppShell>
      <div className="p-6 md:p-10 max-w-5xl">
        {role !== "staff" && (
          <Link
            to="/app/clients"
            className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground mb-4"
          >
            <ArrowLeft className="h-4 w-4" /> All clients
          </Link>
        )}

        <div className="flex flex-wrap items-start justify-between gap-4 mb-8">
          <div>
            <h1 className="font-display text-3xl font-semibold tracking-tight">
              {client.name}
            </h1>
            <div className="mt-2 flex flex-wrap items-center gap-4 text-sm text-muted-foreground">
              {client.phone && (
                <a
                  href={`tel:${client.phone}`}
                  className="inline-flex items-center gap-1.5 hover:text-foreground"
                >
                  <Phone className="h-3.5 w-3.5" />
                  {client.phone}
                </a>
              )}
              {client.email && (
                <a
                  href={`mailto:${client.email}`}
                  className="inline-flex items-center gap-1.5 hover:text-foreground"
                >
                  <Mail className="h-3.5 w-3.5" />
                  {client.email}
                </a>
              )}
              <div>{noShowBadge}</div>
            </div>
          </div>
        </div>

        <div className="grid gap-6 md:grid-cols-3">
          <Card className="md:col-span-1">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
              <CardTitle className="font-display text-lg">Notes</CardTitle>
              {canWrite && !editingNotes && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setNotesDraft(client.notes ?? "");
                    setEditingNotes(true);
                  }}
                >
                  <Pencil className="h-3.5 w-3.5 mr-1.5" /> Edit
                </Button>
              )}
            </CardHeader>
            <CardContent>
              {editingNotes ? (
                <div className="space-y-3">
                  <Textarea
                    value={notesDraft}
                    onChange={(e) => setNotesDraft(e.target.value)}
                    rows={8}
                    dir="auto"
                    placeholder="Allergies, preferences, hair history…"
                  />
                  <div className="flex gap-2 justify-end">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setEditingNotes(false)}
                    >
                      <X className="h-3.5 w-3.5 mr-1.5" /> Cancel
                    </Button>
                    <Button
                      size="sm"
                      onClick={() => notesMut.mutate(notesDraft)}
                      disabled={notesMut.isPending}
                    >
                      <Save className="h-3.5 w-3.5 mr-1.5" />
                      {notesMut.isPending ? "Saving…" : "Save"}
                    </Button>
                  </div>
                </div>
              ) : client.notes ? (
                <p
                  className="whitespace-pre-wrap text-sm text-foreground/90"
                  dir="auto"
                >
                  {client.notes}
                </p>
              ) : (
                <p className="text-sm text-muted-foreground italic">
                  No notes yet.
                </p>
              )}
            </CardContent>
          </Card>

          <Card className="md:col-span-2">
            <CardHeader>
              <CardTitle className="font-display text-lg">Visit history</CardTitle>
            </CardHeader>
            <CardContent>
              {historyQuery.isLoading ? (
                <Skeleton className="h-32 w-full" />
              ) : !historyQuery.data?.length ? (
                <p className="text-sm text-muted-foreground italic">
                  No appointments yet. Once appointments are booked, they'll appear here.
                </p>
              ) : (
                <ul className="divide-y divide-border">
                  {historyQuery.data.map((appt: any) => {
                    const record = appt.service_records?.[0];
                    return (
                      <li key={appt.id} className="py-3 first:pt-0 last:pb-0">
                        <div className="flex flex-wrap items-baseline justify-between gap-2">
                          <div>
                            <div className="font-medium">
                              {record?.service_performed ||
                                appt.service?.name ||
                                "Appointment"}
                            </div>
                            <div className="text-xs text-muted-foreground">
                              {format(parseISO(appt.starts_at), "d MMM yyyy · h:mm a")}
                              {appt.location?.name && ` · ${appt.location.name}`}
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            {appt.price != null && (
                              <span className="text-sm font-medium">
                                {appt.currency || "QAR"} {Number(appt.price).toFixed(2)}
                              </span>
                            )}
                            <Badge
                              variant={
                                appt.status === "completed"
                                  ? "default"
                                  : appt.status === "no_show" || appt.status === "cancelled"
                                    ? "destructive"
                                    : "secondary"
                              }
                              className="capitalize"
                            >
                              {STATUS_LABEL[appt.status] ?? appt.status}
                            </Badge>
                          </div>
                        </div>
                        {record?.formula_notes && (
                          <p
                            className="mt-1.5 text-xs text-muted-foreground whitespace-pre-wrap"
                            dir="auto"
                          >
                            {record.formula_notes}
                          </p>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </AppShell>
  );
}
