import { errorMessage } from "@/lib/error-message";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { format, parseISO } from "date-fns";
import { ArrowLeft, Boxes, Mail, MessageCircle, Phone, Pencil, Save, X } from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/hooks/use-tenant";
import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";

export const Route = createFileRoute("/_authenticated/app/clients/$id")({
  head: () => ({
    meta: [{ title: "Client — Q-Salon Suite" }, { name: "robots", content: "noindex" }],
  }),
  component: ClientDetailPage,
});

type ClientPackageOverview = {
  client_package_id: string;
  package_name: string;
  purchased_at: string;
  expires_at: string | null;
  status: string;
  // Derived live by the database from expires_at and remaining sessions, not
  // read from the stored status column.
  effective_status: string;
  total_remaining: number;
  total_included: number;
  services: { service_id: string; service_name: string; remaining: number; included: number }[];
};

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

  const consentMut = useMutation({
    mutationFn: async (optIn: boolean) => {
      const now = new Date().toISOString();
      const { error } = await supabase
        .from("clients")
        .update({
          whatsapp_opt_in: optIn,
          // Keep both timestamps: an opt-out must not erase the record of when
          // consent was originally given, which is the compliance evidence.
          ...(optIn ? { whatsapp_opt_in_at: now } : { whatsapp_opt_out_at: now }),
          whatsapp_consent_source: "staff_manual",
        })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: (_d, optIn) => {
      toast.success(optIn ? "WhatsApp updates enabled" : "WhatsApp updates stopped");
      queryClient.invalidateQueries({ queryKey: ["client", id] });
    },
    onError: (e) => toast.error(errorMessage(e, "Could not update") ?? "Could not update"),
  });

  const clientQuery = useQuery({
    enabled: !!id,
    queryKey: ["client", id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("clients")
        .select("id, brand_id, name, phone, email, notes, no_show_count, created_at, whatsapp_opt_in, whatsapp_opt_in_at, whatsapp_opt_out_at")
        .eq("id", id)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const packagesQuery = useQuery({
    enabled: !!id && !!clientQuery.data?.brand_id,
    queryKey: ["client-packages-overview", id],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("client_packages_overview", {
        _brand_id: clientQuery.data!.brand_id,
        _client_id: id,
      });
      if (error) throw error;
      // `services` arrives as jsonb, which the generated types widen to Json.
      return (data ?? []) as unknown as ClientPackageOverview[];
    },
  });
  const packages = packagesQuery.data ?? [];

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

        {/* Packages this client holds. Section 11 item 3 asks for a
            staff-visible flag on the profile, including the expired-with-
            sessions-left case — nothing happens to those automatically, so
            somebody has to be able to see them. */}
        {packages.length > 0 && (
          <Card className="mb-6">
            <CardHeader className="pb-3">
              <CardTitle className="font-display text-lg flex items-center gap-2">
                <Boxes className="h-4 w-4" /> Packages
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {packages.map((p) => (
                <div
                  key={p.client_package_id}
                  className="flex flex-wrap items-start justify-between gap-3 rounded-md border border-border p-3"
                >
                  <div className="min-w-0 text-sm">
                    <div className="flex items-center gap-2">
                      <p className="font-medium">{p.package_name}</p>
                      {p.effective_status === "active" && (
                        <Badge variant="secondary">
                          {p.total_remaining} of {p.total_included} left
                        </Badge>
                      )}
                      {p.effective_status === "expired" && p.total_remaining > 0 && (
                        <Badge className="border-transparent bg-amber-100 text-amber-900 hover:bg-amber-100">
                          Expired · {p.total_remaining} unused
                        </Badge>
                      )}
                      {p.effective_status === "expired" && p.total_remaining <= 0 && (
                        <Badge variant="outline">Expired</Badge>
                      )}
                      {p.effective_status === "used" && <Badge variant="outline">Fully used</Badge>}
                      {p.effective_status === "refunded" && (
                        <Badge variant="outline">Refunded</Badge>
                      )}
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {(p.services ?? [])
                        .map((s) => `${s.service_name} ${s.remaining}/${s.included}`)
                        .join(" · ")}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Bought {format(parseISO(p.purchased_at), "d MMM yyyy")}
                      {p.expires_at
                        ? ` · ${new Date(p.expires_at) <= new Date() ? "expired" : "expires"} ${format(parseISO(p.expires_at), "d MMM yyyy")}`
                        : " · no expiry"}
                    </p>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        )}

        {/* Staff-facing consent control. Section 10 item 3: STOP handles the
            client who texts in, but the common real-world case is someone
            asking in person or by phone — that has to be recordable here. */}
        <Card className="mb-6">
          <CardHeader className="pb-3">
            <CardTitle className="font-display text-lg flex items-center gap-2">
              <MessageCircle className="h-4 w-4" /> WhatsApp updates
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="text-sm">
                <p className="font-medium">
                  {client.whatsapp_opt_in ? "Opted in" : "Not opted in"}
                </p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {client.whatsapp_opt_in
                    ? "Receives booking confirmations and reminders for every booking with this salon."
                    : "Receives no automated WhatsApp messages."}
                </p>
                {/* Both timestamps are kept on purpose — an opt-out must not
                    erase when consent was originally given, which is the
                    evidence if the sender is ever reported to Meta. */}
                {client.whatsapp_opt_in_at && (
                  <p className="mt-1.5 text-xs text-muted-foreground">
                    Opted in {format(parseISO(client.whatsapp_opt_in_at), "d MMM yyyy, HH:mm")}
                  </p>
                )}
                {client.whatsapp_opt_out_at && (
                  <p className="text-xs text-muted-foreground">
                    Opted out {format(parseISO(client.whatsapp_opt_out_at), "d MMM yyyy, HH:mm")}
                  </p>
                )}
                {!client.phone && (
                  <p className="mt-1.5 text-xs text-amber-700">
                    No phone number on record — nothing can be sent regardless.
                  </p>
                )}
              </div>

              {canWrite && (
                <Switch
                  aria-label="WhatsApp updates"
                  checked={!!client.whatsapp_opt_in}
                  disabled={consentMut.isPending}
                  onCheckedChange={(v) => consentMut.mutate(v)}
                />
              )}
            </div>
          </CardContent>
        </Card>

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
