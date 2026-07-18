import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  addDays,
  addMinutes,
  format,
  isSameDay,
  parseISO,
  startOfDay,
  startOfWeek,
} from "date-fns";
import { CalendarDays, ChevronLeft, ChevronRight, Plus, MessageCircle, MoreVertical } from "lucide-react";
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export const Route = createFileRoute("/_authenticated/app/appointments")({
  head: () => ({
    meta: [{ title: "Appointments — Q-Salon Suite" }, { name: "robots", content: "noindex" }],
  }),
  component: AppointmentsPage,
});

type ApptStatus = "scheduled" | "completed" | "cancelled" | "no_show";

type Appointment = {
  id: string;
  brand_id: string;
  location_id: string;
  client_id: string;
  staff_user_id: string;
  service_id: string | null;
  starts_at: string;
  ends_at: string;
  status: ApptStatus;
  notes: string | null;
  price: number | null;
  currency: string;
};

type StaffOpt = { user_id: string; full_name: string | null; email: string | null; role: string; location_id: string | null };
type ServiceRow = { id: string; name: string; duration_minutes: number; default_price: number | null; currency: string };
type ClientRow = { id: string; name: string; phone: string | null };
type LocationRow = { id: string; name: string };

const SLOT_MIN = 30;
const DAY_START_HR = 8;
const DAY_END_HR = 22;
const TIMES: string[] = [];
for (let h = DAY_START_HR; h < DAY_END_HR; h++) {
  for (let m = 0; m < 60; m += SLOT_MIN) {
    TIMES.push(`${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`);
  }
}

function statusColor(s: ApptStatus): string {
  switch (s) {
    case "scheduled":
      return "bg-accent/20 border-accent/40 text-foreground";
    case "completed":
      return "bg-emerald-100 border-emerald-300 text-emerald-950";
    case "cancelled":
      return "bg-muted border-border text-muted-foreground line-through";
    case "no_show":
      return "bg-red-100 border-red-300 text-red-950";
  }
}

function AppointmentsPage() {
  const tenant = useTenant();
  if (tenant.isLoading) {
    return (
      <AppShell>
        <div className="p-8"><Skeleton className="h-96 w-full" /></div>
      </AppShell>
    );
  }
  if (!tenant.data?.brandId) return null;
  const role = tenant.data.primaryRole;
  if (role === "staff") {
    return <AppShell><MyAppointments /></AppShell>;
  }
  return <AppShell><CalendarView /></AppShell>;
}

// ============================================================
// STAFF ROLE: MY APPOINTMENTS LIST
// ============================================================

function MyAppointments() {
  const tenant = useTenant();
  const userId = tenant.data!.userId!;
  const [date, setDate] = useState<Date>(startOfDay(new Date()));

  const { data: appts = [] } = useQuery({
    queryKey: ["my-appts", userId, date.toISOString()],
    queryFn: async () => {
      const start = startOfDay(date).toISOString();
      const end = addDays(startOfDay(date), 1).toISOString();
      const { data, error } = await supabase
        .from("appointments")
        .select("*")
        .eq("staff_user_id", userId)
        .gte("starts_at", start)
        .lt("starts_at", end)
        .order("starts_at");
      if (error) throw error;
      return data as Appointment[];
    },
  });

  return (
    <div className="p-6 md:p-8">
      <header className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="font-display text-2xl font-semibold">My appointments</h1>
          <p className="text-sm text-muted-foreground">{format(date, "EEEE, MMMM d, yyyy")}</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="icon" onClick={() => setDate(addDays(date, -1))}><ChevronLeft className="h-4 w-4" /></Button>
          <Button variant="outline" onClick={() => setDate(startOfDay(new Date()))}>Today</Button>
          <Button variant="outline" size="icon" onClick={() => setDate(addDays(date, 1))}><ChevronRight className="h-4 w-4" /></Button>
        </div>
      </header>
      {appts.length === 0 ? (
        <Card className="p-10 text-center text-sm text-muted-foreground">Nothing booked for this day.</Card>
      ) : (
        <div className="space-y-2">
          {appts.map((a) => <StaffApptCard key={a.id} appt={a} />)}
        </div>
      )}
    </div>
  );
}

function StaffApptCard({ appt }: { appt: Appointment }) {
  const { data: client } = useQuery({
    queryKey: ["client-mini", appt.client_id],
    queryFn: async () => {
      const { data } = await supabase.from("clients").select("id, name, phone").eq("id", appt.client_id).maybeSingle();
      return data as ClientRow | null;
    },
  });
  return (
    <Card className={`p-4 border-l-4 ${statusColor(appt.status)}`}>
      <div className="flex items-center justify-between">
        <div>
          <div className="font-medium">{format(parseISO(appt.starts_at), "HH:mm")} – {format(parseISO(appt.ends_at), "HH:mm")}</div>
          <div className="text-sm">{client?.name ?? "Client"}</div>
          {client?.phone && <div className="text-xs text-muted-foreground">{client.phone}</div>}
        </div>
        <StatusMenu appt={appt} />
      </div>
      {appt.notes && <p className="mt-2 text-xs text-muted-foreground">{appt.notes}</p>}
    </Card>
  );
}

// ============================================================
// OWNER/MANAGER/RECEPTIONIST: CALENDAR
// ============================================================

function CalendarView() {
  const tenant = useTenant();
  const brandId = tenant.data!.brandId!;
  const role = tenant.data!.primaryRole!;
  const tenantLoc = tenant.data!.locationId;

  const [view, setView] = useState<"day" | "week">("day");
  const [date, setDate] = useState<Date>(startOfDay(new Date()));
  const [locationId, setLocationId] = useState<string | null>(tenantLoc);
  const [modal, setModal] = useState<{ open: boolean; staffId?: string; when?: Date; edit?: Appointment } | null>(null);

  const { data: locations = [] } = useQuery({
    queryKey: ["locations", brandId],
    queryFn: async () => {
      const { data, error } = await supabase.from("locations").select("id, name").eq("brand_id", brandId).eq("is_active", true).order("name");
      if (error) throw error;
      return data as LocationRow[];
    },
  });

  // Auto-pick first location when owner has none
  const effectiveLocId = locationId ?? locations[0]?.id ?? null;

  const { data: staff = [] } = useQuery({
    queryKey: ["loc-staff", brandId, effectiveLocId],
    enabled: !!effectiveLocId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("user_roles")
        .select("user_id, role, location_id")
        .eq("brand_id", brandId)
        .not("user_id", "is", null);
      if (error) throw error;
      const rows = (data ?? []).filter((r) => r.role === "owner" || r.location_id === effectiveLocId);
      const ids = rows.map((r) => r.user_id).filter(Boolean) as string[];
      let profilesById: Record<string, { full_name: string | null; email: string | null }> = {};
      if (ids.length > 0) {
        const { data: profs } = await supabase.from("profiles").select("id, full_name, email").in("id", ids);
        for (const p of profs ?? []) profilesById[p.id] = { full_name: p.full_name, email: p.email };
      }
      return rows.map((r) => ({
        user_id: r.user_id!,
        full_name: profilesById[r.user_id!]?.full_name ?? null,
        email: profilesById[r.user_id!]?.email ?? null,
        role: r.role,
        location_id: r.location_id,
      })) as StaffOpt[];
    },
  });

  const rangeStart = view === "day" ? startOfDay(date) : startOfWeek(date, { weekStartsOn: 0 });
  const rangeEnd = addDays(rangeStart, view === "day" ? 1 : 7);

  const { data: appts = [] } = useQuery({
    queryKey: ["appts", brandId, effectiveLocId, rangeStart.toISOString(), rangeEnd.toISOString()],
    enabled: !!effectiveLocId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("appointments")
        .select("*")
        .eq("brand_id", brandId)
        .eq("location_id", effectiveLocId!)
        .gte("starts_at", rangeStart.toISOString())
        .lt("starts_at", rangeEnd.toISOString())
        .order("starts_at");
      if (error) throw error;
      return data as Appointment[];
    },
  });

  const days = view === "day" ? [rangeStart] : Array.from({ length: 7 }, (_, i) => addDays(rangeStart, i));

  return (
    <div className="flex h-screen flex-col">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border bg-background/80 px-4 py-3 backdrop-blur md:px-6">
        <div className="flex items-center gap-2">
          <h1 className="font-display text-xl font-semibold">Appointments</h1>
          <Badge variant="outline" className="ml-2">
            <CalendarDays className="mr-1 h-3 w-3" />
            {format(date, view === "day" ? "EEE, MMM d" : "'Week of' MMM d")}
          </Badge>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {role === "owner" && locations.length > 1 && (
            <Select value={effectiveLocId ?? ""} onValueChange={(v) => setLocationId(v)}>
              <SelectTrigger className="h-9 w-48"><SelectValue placeholder="Location" /></SelectTrigger>
              <SelectContent>
                {locations.map((l) => <SelectItem key={l.id} value={l.id}>{l.name}</SelectItem>)}
              </SelectContent>
            </Select>
          )}
          <div className="flex rounded-md border border-border p-0.5">
            <button className={`rounded px-3 py-1 text-xs font-medium ${view === "day" ? "bg-accent text-accent-foreground" : ""}`} onClick={() => setView("day")}>Day</button>
            <button className={`rounded px-3 py-1 text-xs font-medium ${view === "week" ? "bg-accent text-accent-foreground" : ""}`} onClick={() => setView("week")}>Week</button>
          </div>
          <Button variant="outline" size="icon" onClick={() => setDate(addDays(date, view === "day" ? -1 : -7))}><ChevronLeft className="h-4 w-4" /></Button>
          <Button variant="outline" onClick={() => setDate(startOfDay(new Date()))}>Today</Button>
          <Button variant="outline" size="icon" onClick={() => setDate(addDays(date, view === "day" ? 1 : 7))}><ChevronRight className="h-4 w-4" /></Button>
          <Button onClick={() => setModal({ open: true })}><Plus className="mr-1 h-4 w-4" /> New</Button>
        </div>
      </header>

      <div className="flex-1 overflow-auto">
        {!effectiveLocId ? (
          <div className="p-10 text-center text-sm text-muted-foreground">No active location.</div>
        ) : view === "day" ? (
          <DayGrid
            day={rangeStart}
            staff={staff}
            appts={appts}
            onSlotClick={(staffId, when) => setModal({ open: true, staffId, when })}
            onApptClick={(a) => setModal({ open: true, edit: a })}
          />
        ) : (
          <WeekGrid
            days={days}
            appts={appts}
            onDayClick={(d) => { setView("day"); setDate(d); }}
          />
        )}
      </div>

      {modal?.open && (
        <AppointmentDialog
          open={modal.open}
          onOpenChange={(o) => !o && setModal(null)}
          brandId={brandId}
          locationId={effectiveLocId!}
          staff={staff}
          initialStaffId={modal.staffId}
          initialWhen={modal.when}
          edit={modal.edit}
        />
      )}
    </div>
  );
}

function DayGrid({
  day, staff, appts, onSlotClick, onApptClick,
}: {
  day: Date;
  staff: StaffOpt[];
  appts: Appointment[];
  onSlotClick: (staffId: string, when: Date) => void;
  onApptClick: (a: Appointment) => void;
}) {
  if (staff.length === 0) {
    return <div className="p-10 text-center text-sm text-muted-foreground">No staff assigned to this location yet.</div>;
  }
  const rowH = 40; // px per 30-min slot
  return (
    <div className="min-w-max">
      <div className="sticky top-0 z-20 grid border-b border-border bg-background" style={{ gridTemplateColumns: `72px repeat(${staff.length}, minmax(160px, 1fr))` }}>
        <div />
        {staff.map((s) => (
          <div key={s.user_id} className="border-l border-border px-3 py-2 text-xs">
            <div className="font-medium">{s.full_name || s.email || "Staff"}</div>
            <div className="text-muted-foreground capitalize">{s.role}</div>
          </div>
        ))}
      </div>
      <div className="relative grid" style={{ gridTemplateColumns: `72px repeat(${staff.length}, minmax(160px, 1fr))` }}>
        <div>
          {TIMES.map((t) => (
            <div key={t} className="flex items-start justify-end pr-2 text-[10px] text-muted-foreground" style={{ height: rowH }}>
              {t.endsWith(":00") && t}
            </div>
          ))}
        </div>
        {staff.map((s) => (
          <div key={s.user_id} className="relative border-l border-border">
            {TIMES.map((t) => {
              const [hh, mm] = t.split(":").map(Number);
              const when = new Date(day);
              when.setHours(hh, mm, 0, 0);
              return (
                <button
                  key={t}
                  onClick={() => onSlotClick(s.user_id, when)}
                  className="block w-full border-b border-border/60 hover:bg-accent/10"
                  style={{ height: rowH }}
                />
              );
            })}
            {appts.filter((a) => a.staff_user_id === s.user_id && isSameDay(parseISO(a.starts_at), day)).map((a) => {
              const start = parseISO(a.starts_at);
              const end = parseISO(a.ends_at);
              const minsFromTop = (start.getHours() - DAY_START_HR) * 60 + start.getMinutes();
              const dur = Math.max(15, (end.getTime() - start.getTime()) / 60000);
              const top = (minsFromTop / SLOT_MIN) * rowH;
              const height = (dur / SLOT_MIN) * rowH - 2;
              return (
                <button
                  key={a.id}
                  onClick={() => onApptClick(a)}
                  className={`absolute left-1 right-1 overflow-hidden rounded-md border p-1.5 text-left text-xs shadow-sm ${statusColor(a.status)}`}
                  style={{ top, height }}
                >
                  <ApptCardMini appt={a} />
                </button>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

function ApptCardMini({ appt }: { appt: Appointment }) {
  const { data: client } = useQuery({
    queryKey: ["client-mini", appt.client_id],
    queryFn: async () => (await supabase.from("clients").select("id, name, phone").eq("id", appt.client_id).maybeSingle()).data as ClientRow | null,
  });
  const { data: svc } = useQuery({
    queryKey: ["service-mini", appt.service_id],
    enabled: !!appt.service_id,
    queryFn: async () => (await supabase.from("services").select("id, name").eq("id", appt.service_id!).maybeSingle()).data as { id: string; name: string } | null,
  });
  return (
    <>
      <div className="font-semibold leading-tight">{format(parseISO(appt.starts_at), "HH:mm")} {client?.name ?? "Client"}</div>
      {svc && <div className="truncate opacity-80">{svc.name}</div>}
    </>
  );
}

function WeekGrid({ days, appts, onDayClick }: { days: Date[]; appts: Appointment[]; onDayClick: (d: Date) => void }) {
  return (
    <div className="grid grid-cols-7 gap-2 p-4">
      {days.map((d) => {
        const dayAppts = appts.filter((a) => isSameDay(parseISO(a.starts_at), d));
        return (
          <button key={d.toISOString()} onClick={() => onDayClick(d)} className="min-h-40 rounded-lg border border-border bg-card p-3 text-left transition-colors hover:border-accent/50">
            <div className="mb-2 text-xs font-medium">{format(d, "EEE d")}</div>
            <div className="space-y-1">
              {dayAppts.slice(0, 6).map((a) => (
                <div key={a.id} className={`truncate rounded border px-1.5 py-0.5 text-[10px] ${statusColor(a.status)}`}>
                  {format(parseISO(a.starts_at), "HH:mm")}
                </div>
              ))}
              {dayAppts.length > 6 && <div className="text-[10px] text-muted-foreground">+{dayAppts.length - 6} more</div>}
            </div>
          </button>
        );
      })}
    </div>
  );
}

// ============================================================
// APPOINTMENT DIALOG (Create / Edit)
// ============================================================

function AppointmentDialog({
  open, onOpenChange, brandId, locationId, staff, initialStaffId, initialWhen, edit,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  brandId: string;
  locationId: string;
  staff: StaffOpt[];
  initialStaffId?: string;
  initialWhen?: Date;
  edit?: Appointment;
}) {
  const qc = useQueryClient();
  const [clientId, setClientId] = useState(edit?.client_id ?? "");
  const [clientSearch, setClientSearch] = useState("");
  const [serviceId, setServiceId] = useState<string>(edit?.service_id ?? "");
  const [staffId, setStaffId] = useState(edit?.staff_user_id ?? initialStaffId ?? "");
  const initDate = edit ? parseISO(edit.starts_at) : initialWhen ?? new Date();
  const [dateStr, setDateStr] = useState(format(initDate, "yyyy-MM-dd"));
  const [timeStr, setTimeStr] = useState(format(initDate, "HH:mm"));
  const [notes, setNotes] = useState(edit?.notes ?? "");
  const [newClientMode, setNewClientMode] = useState(false);
  const [newClientName, setNewClientName] = useState("");
  const [newClientPhone, setNewClientPhone] = useState("");
  const [warning, setWarning] = useState<string | null>(null);

  const { data: services = [] } = useQuery({
    queryKey: ["services", brandId],
    queryFn: async () => {
      const { data, error } = await supabase.from("services").select("id, name, duration_minutes, default_price, currency").eq("brand_id", brandId).eq("is_active", true).order("name");
      if (error) throw error;
      return data as ServiceRow[];
    },
  });
  const { data: locPrices = [] } = useQuery({
    queryKey: ["loc-prices", locationId],
    queryFn: async () => {
      const { data, error } = await supabase.from("service_location_prices").select("service_id, price, currency").eq("location_id", locationId);
      if (error) throw error;
      return data as { service_id: string; price: number; currency: string }[];
    },
  });
  const { data: clients = [] } = useQuery({
    queryKey: ["clients-list", brandId, clientSearch],
    queryFn: async () => {
      let q = supabase.from("clients").select("id, name, phone").eq("brand_id", brandId).order("name").limit(20);
      if (clientSearch.trim()) q = q.or(`name.ilike.%${clientSearch}%,phone.ilike.%${clientSearch}%`);
      const { data, error } = await q;
      if (error) throw error;
      return data as ClientRow[];
    },
  });

  const selectedService = services.find((s) => s.id === serviceId);
  const priceOverride = locPrices.find((p) => p.service_id === serviceId);
  const effectivePrice = priceOverride?.price ?? selectedService?.default_price ?? null;
  const currency = priceOverride?.currency ?? selectedService?.currency ?? "QAR";

  const { data: schedule } = useQuery({
    queryKey: ["staff-sched", staffId, locationId],
    enabled: !!staffId && !!locationId,
    queryFn: async () => {
      const { data } = await supabase.from("staff_schedules").select("day_of_week, start_time, end_time").eq("user_id", staffId).eq("location_id", locationId);
      return data as { day_of_week: number; start_time: string; end_time: string }[] | null;
    },
  });
  const { data: leave } = useQuery({
    queryKey: ["staff-leave", staffId],
    enabled: !!staffId,
    queryFn: async () => {
      const { data } = await supabase.from("staff_leave").select("start_date, end_date").eq("user_id", staffId);
      return data as { start_date: string; end_date: string }[] | null;
    },
  });

  // Soft warnings
  useMemo(() => {
    if (!staffId || !selectedService) { setWarning(null); return; }
    const [y, m, d] = dateStr.split("-").map(Number);
    const [hh, mm] = timeStr.split(":").map(Number);
    const start = new Date(y, m - 1, d, hh, mm);
    const dow = start.getDay();
    const onLeave = (leave ?? []).some((l) => dateStr >= l.start_date && dateStr <= l.end_date);
    if (onLeave) { setWarning("This staff member is on leave that day."); return; }
    const sched = (schedule ?? []).filter((s) => s.day_of_week === dow);
    if (sched.length === 0) {
      setWarning(null); // no schedule → soft, no message
      return;
    }
    const t = `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
    const inShift = sched.some((s) => t >= s.start_time.slice(0, 5) && t < s.end_time.slice(0, 5));
    setWarning(inShift ? null : "Outside this staff member's working hours.");
  }, [staffId, serviceId, dateStr, timeStr, schedule, leave, selectedService]);

  const save = useMutation({
    mutationFn: async () => {
      let cid = clientId;
      if (newClientMode) {
        if (!newClientName.trim()) throw new Error("Client name is required");
        const { data, error } = await supabase.from("clients").insert({ brand_id: brandId, name: newClientName.trim(), phone: newClientPhone.trim() || null }).select("id").single();
        if (error) throw error;
        cid = data.id;
      }
      if (!cid) throw new Error("Choose a client");
      if (!serviceId) throw new Error("Choose a service");
      if (!staffId) throw new Error("Choose a staff member");
      const [y, m, d] = dateStr.split("-").map(Number);
      const [hh, mm] = timeStr.split(":").map(Number);
      const start = new Date(y, m - 1, d, hh, mm);
      const end = addMinutes(start, selectedService!.duration_minutes);
      const payload = {
        brand_id: brandId,
        location_id: locationId,
        client_id: cid,
        staff_user_id: staffId,
        service_id: serviceId,
        starts_at: start.toISOString(),
        ends_at: end.toISOString(),
        notes: notes.trim() || null,
        price: effectivePrice,
        currency,
      };
      if (edit) {
        const { error } = await supabase.from("appointments").update(payload).eq("id", edit.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("appointments").insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      toast.success(edit ? "Appointment updated" : "Appointment booked");
      qc.invalidateQueries({ queryKey: ["appts"] });
      onOpenChange(false);
    },
    onError: (e) => {
      const msg = e instanceof Error ? e.message : "Failed";
      if (msg.toLowerCase().includes("overlap")) toast.error("Double-booked", { description: "This staff member already has an appointment in that time window." });
      else toast.error(msg);
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{edit ? "Edit appointment" : "New appointment"}</DialogTitle>
          <DialogDescription>All fields required unless marked optional.</DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>Client</Label>
            {newClientMode ? (
              <div className="space-y-2 rounded-md border border-dashed border-border p-2">
                <Input placeholder="Client name" value={newClientName} onChange={(e) => setNewClientName(e.target.value)} />
                <Input placeholder="Phone (optional)" value={newClientPhone} onChange={(e) => setNewClientPhone(e.target.value)} />
                <button type="button" className="text-xs text-muted-foreground underline" onClick={() => setNewClientMode(false)}>Pick existing instead</button>
              </div>
            ) : (
              <>
                <Input placeholder="Search by name or phone" value={clientSearch} onChange={(e) => setClientSearch(e.target.value)} />
                <div className="max-h-32 overflow-y-auto rounded-md border border-border">
                  {clients.map((c) => (
                    <button key={c.id} type="button" onClick={() => setClientId(c.id)} className={`flex w-full items-center justify-between px-3 py-1.5 text-left text-sm hover:bg-accent/10 ${clientId === c.id ? "bg-accent/20" : ""}`}>
                      <span>{c.name}</span>
                      <span className="text-xs text-muted-foreground">{c.phone}</span>
                    </button>
                  ))}
                  {clients.length === 0 && <div className="px-3 py-2 text-xs text-muted-foreground">No matches.</div>}
                </div>
                <button type="button" className="text-xs text-accent underline" onClick={() => setNewClientMode(true)}>+ New client</button>
              </>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Service</Label>
              <Select value={serviceId} onValueChange={setServiceId}>
                <SelectTrigger><SelectValue placeholder="Select service" /></SelectTrigger>
                <SelectContent>
                  {services.map((s) => <SelectItem key={s.id} value={s.id}>{s.name} · {s.duration_minutes}m</SelectItem>)}
                </SelectContent>
              </Select>
              {selectedService && (
                <div className="text-xs text-muted-foreground">
                  {selectedService.duration_minutes} min · {currency} {effectivePrice ?? "—"} {priceOverride && <span className="ml-1 rounded bg-accent/20 px-1">location price</span>}
                </div>
              )}
            </div>
            <div className="space-y-1.5">
              <Label>Staff</Label>
              <Select value={staffId} onValueChange={setStaffId}>
                <SelectTrigger><SelectValue placeholder="Select staff" /></SelectTrigger>
                <SelectContent>
                  {staff.map((s) => <SelectItem key={s.user_id} value={s.user_id}>{s.full_name || s.email}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Date</Label>
              <Input type="date" value={dateStr} onChange={(e) => setDateStr(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Start time</Label>
              <Input type="time" value={timeStr} onChange={(e) => setTimeStr(e.target.value)} step={300} />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Notes (optional)</Label>
            <Textarea dir="auto" value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
          </div>

          {warning && (
            <div className="rounded-md border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900">
              ⚠ {warning} You can still save — the salon can override this.
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={() => save.mutate()} disabled={save.isPending}>
            {save.isPending ? "Saving..." : edit ? "Save changes" : "Book appointment"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ============================================================
// STATUS MENU + COMPLETION
// ============================================================

function StatusMenu({ appt }: { appt: Appointment }) {
  const qc = useQueryClient();
  const [completeOpen, setCompleteOpen] = useState(false);

  const setStatus = useMutation({
    mutationFn: async (status: ApptStatus) => {
      const { error } = await supabase.from("appointments").update({ status }).eq("id", appt.id);
      if (error) throw error;
    },
    onSuccess: (_d, status) => {
      toast.success(`Marked ${status.replace("_", " ")}`);
      qc.invalidateQueries({ queryKey: ["appts"] });
      qc.invalidateQueries({ queryKey: ["my-appts"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  function waLink() {
    const dt = format(parseISO(appt.starts_at), "EEE d MMM, HH:mm");
    const msg = encodeURIComponent(`Hi! Reminder for your appointment on ${dt}. See you soon 💫`);
    return `https://wa.me/?text=${msg}`;
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" onClick={(e) => e.stopPropagation()}><MoreVertical className="h-4 w-4" /></Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
          <DropdownMenuItem onClick={() => setCompleteOpen(true)}>Mark completed</DropdownMenuItem>
          <DropdownMenuItem onClick={() => setStatus.mutate("no_show")}>Mark no-show</DropdownMenuItem>
          <DropdownMenuItem onClick={() => setStatus.mutate("cancelled")}>Cancel</DropdownMenuItem>
          <DropdownMenuItem onClick={() => window.open(waLink(), "_blank")}>
            <MessageCircle className="mr-2 h-4 w-4" /> WhatsApp reminder
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {completeOpen && <CompleteDialog appt={appt} open={completeOpen} onOpenChange={setCompleteOpen} />}
    </>
  );
}

function CompleteDialog({ appt, open, onOpenChange }: { appt: Appointment; open: boolean; onOpenChange: (o: boolean) => void }) {
  const qc = useQueryClient();
  const tenant = useTenant();
  const [servicePerformed, setServicePerformed] = useState("");
  const [formulaNotes, setFormulaNotes] = useState("");
  const [amount, setAmount] = useState<string>(appt.price != null ? String(appt.price) : "");
  const [method, setMethod] = useState<"cash" | "card" | "bank_transfer">("cash");

  const submit = useMutation({
    mutationFn: async () => {
      const amt = parseFloat(amount);
      if (isNaN(amt) || amt < 0) throw new Error("Enter a valid amount");
      // service_record
      const { error: srErr } = await supabase.from("service_records").insert({
        appointment_id: appt.id,
        technician_user_id: appt.staff_user_id,
        service_performed: servicePerformed.trim() || "—",
        formula_notes: formulaNotes.trim() || null,
      });
      if (srErr && !srErr.message.toLowerCase().includes("duplicate")) throw srErr;
      // income
      const { error: incErr } = await supabase.from("income_records").insert({
        appointment_id: appt.id,
        location_id: appt.location_id,
        brand_id: appt.brand_id,
        amount: amt,
        currency: appt.currency,
        method,
        collected_by: tenant.data?.userId ?? null,
      });
      if (incErr) throw incErr;
      // status
      const { error: sErr } = await supabase.from("appointments").update({ status: "completed", price: amt }).eq("id", appt.id);
      if (sErr) throw sErr;
    },
    onSuccess: () => {
      toast.success("Appointment completed");
      qc.invalidateQueries({ queryKey: ["appts"] });
      qc.invalidateQueries({ queryKey: ["my-appts"] });
      onOpenChange(false);
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Complete appointment</DialogTitle>
          <DialogDescription>Log what was done and payment collected.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>Service performed / notes (optional)</Label>
            <Input dir="auto" value={servicePerformed} onChange={(e) => setServicePerformed(e.target.value)} placeholder="e.g. Balayage, root touch-up" />
          </div>
          <div className="space-y-1.5">
            <Label>Formula / product notes (optional)</Label>
            <Textarea dir="auto" value={formulaNotes} onChange={(e) => setFormulaNotes(e.target.value)} rows={2} placeholder="Formula details, products used…" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Amount ({appt.currency})</Label>
              <Input type="number" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Payment</Label>
              <Select value={method} onValueChange={(v) => setMethod(v as "cash" | "card" | "bank_transfer")}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="cash">Cash</SelectItem>
                  <SelectItem value="card">Card</SelectItem>
                  <SelectItem value="bank_transfer">Bank transfer</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={() => submit.mutate()} disabled={submit.isPending}>
            {submit.isPending ? "Saving..." : "Complete & log income"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
