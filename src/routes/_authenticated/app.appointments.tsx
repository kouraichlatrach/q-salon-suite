import { errorMessage } from "@/lib/error-message";
import { createFileRoute, stripSearchParams, useNavigate } from "@tanstack/react-router";
import { zodValidator } from "@tanstack/zod-adapter";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  addDays,
  addMinutes,
  format,
  isSameDay,
  parseISO,
  startOfDay,
} from "date-fns";
import { CalendarDays, ChevronLeft, ChevronRight, Plus, MessageCircle, MoreVertical } from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/hooks/use-tenant";
import { formatMoney } from "@/lib/money";
import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
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
import type { MultiSelectOption } from "@/components/ui/multi-select";
import {
  ActiveFilterChips,
  AppointmentFilters,
  DateRangeControl,
} from "@/components/appointment-filters";
import {
  type AppointmentSearch,
  APPOINTMENT_SEARCH_DEFAULTS,
  appointmentSearchSchema,

  formatDateParam,
  parseList,
  resolveLocationId,
  resolveRange,
} from "@/lib/appointment-filters";

export const Route = createFileRoute("/_authenticated/app/appointments")({
  validateSearch: zodValidator(appointmentSearchSchema),
  // Keeps a shared link readable: anything still at its default is dropped
  // from the query string instead of riding along as `staff=&service=&q=`.
  search: { middlewares: [stripSearchParams(APPOINTMENT_SEARCH_DEFAULTS)] },
  head: () => ({
    meta: [{ title: "Appointments — Q-Salon Suite" }, { name: "robots", content: "noindex" }],
  }),
  component: AppointmentsPage,
});

/**
 * Writes a filter change back to the URL. `replace` keeps the browser Back
 * button useful — narrowing a filter five times should not cost five presses
 * to get out of.
 *
 * Params left at their default are kept out of the URL by the route's
 * `stripSearchParams` middleware, not here — deleting them in this updater
 * does nothing, because `validateSearch` re-applies the zod defaults before
 * the router serialises. (Learned the hard way; don't re-add that loop.)
 */
function useFilterPatch() {
  const navigate = useNavigate({ from: Route.fullPath });
  return useCallback(
    (patch: Partial<AppointmentSearch>) => {
      navigate({ search: (prev) => ({ ...prev, ...patch }), replace: true });
    },
    [navigate],
  );
}

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
  // Booking-time intent only — which package this visit is expected to be
  // covered by. Nothing is debited until checkout settles it.
  client_package_id: string | null;
};

type PackageOffer = {
  client_package_id: string;
  package_name: string;
  remaining_count: number;
  included_count: number;
  expires_at: string | null;
  covers_amount: number;
  currency: string;
};

type GiftCardLookup = {
  id: string;
  code: string;
  initial_amount: number;
  remaining_amount: number;
  currency: string;
  expires_at: string | null;
  status: string;
  /** Derived live from expires_at, not the stored status column. */
  effective_status: string;
  client_id: string | null;
  error: string | null;
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

/**
 * PostgREST reads `,` `(` `)` as structure inside an `or=` expression, so a
 * client searching for "Smith, J" would otherwise send a malformed filter — and
 * a crafted string could append conditions of its own. Strip the syntax
 * characters rather than escaping them: none of them appear in a real name or
 * phone number, so nothing searchable is lost.
 */
function sanitiseSearchTerm(raw: string): string {
  return raw.replace(/[,()\\*]/g, " ").trim();
}

/**
 * The client name/phone search, expressed as a filter on the embedded `clients`
 * row rather than by first resolving a list of matching client ids.
 *
 * The id-list approach reads more simply but does not survive a real brand: a
 * one-character search matches thousands of clients, and PostgREST takes
 * `in.(...)` as a GET query parameter, so the request URL blows past what the
 * server accepts. Capping the list would have been worse — a search that
 * silently stops at the 500th client is exactly the quietly-wrong shape this
 * project keeps getting bitten by.
 *
 * `!inner` turns the join into a filter: an appointment survives only if its
 * client matches. While a search is active this puts appointment visibility
 * partly under the RLS policy for `clients` — safe here, since every role that
 * reaches this screen already reads client names on it, and the join is only
 * attached when the box is non-empty so an unfiltered calendar is untouched.
 */
function clientSearch(q: string): { select: string; term: string | null } {
  const term = sanitiseSearchTerm(q);
  return term ? { select: "*, clients!inner(id)", term } : { select: "*", term: null };
}

/**
 * Applies the multi-select filters to an appointments query.
 *
 * These are real `IN` clauses sent to PostgREST, not a client-side array
 * filter — a month of appointments for one staff member should not mean
 * downloading the whole month first. Every clause is additive (AND), so
 * combining them narrows to the intersection.
 *
 * This never touches brand/location/staff scoping: those are applied by the
 * caller and enforced underneath by RLS.
 */
type InFilterable<T> = { in(column: string, values: readonly string[]): T };

function applyEntityFilters<T extends InFilterable<T>>(
  query: T,
  search: AppointmentSearch,
  opts: { staff: boolean },
): T {
  let q = query;
  if (opts.staff) {
    const staff = parseList(search.staff);
    if (staff.length > 0) q = q.in("staff_user_id", staff);
  }
  const service = parseList(search.service);
  if (service.length > 0) q = q.in("service_id", service);
  const status = parseList(search.status);
  if (status.length > 0) q = q.in("status", status);
  return q;
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
  if (!tenant.data?.brandId) return <AppShell>{null}</AppShell>;
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
  const brandId = tenant.data!.brandId!;
  const search = Route.useSearch();
  const patch = useFilterPatch();

  const { start, end } = resolveRange(search);
  const anchor = start;

  // Services are brand-wide, so a Staff account can populate this filter
  // without being shown anything about other people's diaries.
  const { data: services = [] } = useQuery({
    queryKey: ["services", brandId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("services")
        .select("id, name, duration_minutes, default_price, currency")
        .eq("brand_id", brandId)
        .eq("is_active", true)
        .order("name");
      if (error) throw error;
      return data as ServiceRow[];
    },
  });

  const { data: appts = [], isPending } = useQuery({
    queryKey: ["my-appts", userId, start.toISOString(), end.toISOString(), search.service, search.status, search.q],
    queryFn: async () => {
      const { select, term } = clientSearch(search.q);

      // The `staff_user_id` equality is the boundary, not a filter — it is
      // applied before anything from the URL and is never widened by one.
      let q = supabase
        .from("appointments")
        .select(select)
        .eq("staff_user_id", userId)
        .gte("starts_at", start.toISOString())
        .lt("starts_at", end.toISOString());
      q = applyEntityFilters(q, search, { staff: false });
      if (term) {
        q = q.or(`name.ilike.%${term}%,phone.ilike.%${term}%`, { referencedTable: "clients" });
      }

      const { data, error } = await q.order("starts_at");
      if (error) throw error;
      return data as unknown as Appointment[];
    },
  });

  const serviceOptions: MultiSelectOption[] = services.map((s) => ({
    value: s.id,
    label: s.name,
    hint: `${s.duration_minutes}m`,
  }));

  function shift(days: number) {
    patch({ preset: "day", date: formatDateParam(addDays(anchor, days)) });
  }

  return (
    <div className="flex h-screen flex-col">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3 md:px-6">
        <div>
          <h1 className="font-display text-2xl font-semibold">My appointments</h1>
          <p className="text-sm text-muted-foreground">
            <RangeLabel search={search} start={start} end={end} />
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <DateRangeControl search={search} onPatch={patch} />
          {search.preset === "day" && (
            <>
              <Button variant="outline" size="icon" aria-label="Previous day" onClick={() => shift(-1)}>
                <ChevronLeft aria-hidden className="h-4 w-4" />
              </Button>
              <Button variant="outline" size="icon" aria-label="Next day" onClick={() => shift(1)}>
                <ChevronRight aria-hidden className="h-4 w-4" />
              </Button>
            </>
          )}
        </div>
      </header>

      <AppointmentFilters
        search={search}
        staffOptions={[]}
        serviceOptions={serviceOptions}
        onPatch={patch}
        showStaff={false}
      />
      <ActiveFilterChips
        search={search}
        staffOptions={[]}
        serviceOptions={serviceOptions}
        resultCount={appts.length}
        onPatch={patch}
        onClearAll={() => patch({ service: "", status: "", q: "" })}
      />

      <div className="flex-1 overflow-auto p-4 md:p-6">
        {isPending ? (
          <Skeleton className="h-64 w-full" />
        ) : appts.length === 0 ? (
          <Card className="p-10 text-center text-sm text-muted-foreground">
            <EmptyMessage search={search} />
          </Card>
        ) : (
          <div className="space-y-2">
            {appts.map((a) => <StaffApptCard key={a.id} appt={a} />)}
          </div>
        )}
      </div>
    </div>
  );
}

/** Human label for whatever window is currently in force. */
function RangeLabel({ search, start, end }: { search: AppointmentSearch; start: Date; end: Date }) {
  const lastDay = addDays(end, -1);
  if (search.preset === "day") return <>{format(start, "EEEE, MMMM d, yyyy")}</>;
  if (search.preset === "month") return <>{format(start, "MMMM yyyy")}</>;
  return <>{format(start, "d MMM yyyy")} – {format(lastDay, "d MMM yyyy")}</>;
}

/** Addresses staff as colleagues, and distinguishes "quiet day" from "filtered to nothing". */
function EmptyMessage({ search }: { search: AppointmentSearch }) {
  const filtered =
    parseList(search.staff).length + parseList(search.service).length + parseList(search.status).length > 0 ||
    search.q.trim().length > 0;
  return filtered ? (
    <>No appointments match these filters. Try widening them.</>
  ) : (
    <>Nothing left on the book for this period.</>
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

  const search = Route.useSearch();
  const patch = useFilterPatch();
  const [modal, setModal] = useState<{ open: boolean; staffId?: string; when?: Date; edit?: Appointment } | null>(null);

  const { data: locations = [] } = useQuery({
    queryKey: ["locations", brandId],
    queryFn: async () => {
      const { data, error } = await supabase.from("locations").select("id, name").eq("brand_id", brandId).eq("is_active", true).order("name");
      if (error) throw error;
      return data as LocationRow[];
    },
  });

  // Only an Owner's `loc` param is honoured; every other role is pinned to
  // their own location no matter what the URL says. RLS refuses cross-location
  // reads underneath this, but a Manager hand-editing the URL should get their
  // own data back rather than a convincing-looking empty calendar.
  const effectiveLocId = resolveLocationId(role, tenantLoc, search, locations[0]?.id ?? null);

  const { data: staff = [] } = useQuery({
    queryKey: ["loc-staff", brandId, effectiveLocId],
    enabled: !!effectiveLocId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("user_roles")
        .select("user_id, role, location_id")
        .eq("brand_id", brandId)
        .eq("role", "staff")
        .not("user_id", "is", null);
      if (error) throw error;
      // Only Staff/Technician accounts are bookable. Owner, Manager and
      // Receptionist run the salon; they are not columns on the calendar and
      // not options in the picker. Enforced for real by the
      // enforce_bookable_staff_role trigger — this filter just stops the UI
      // offering something the database would refuse.
      const rows = (data ?? []).filter((r) => r.location_id === effectiveLocId);
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

  const { data: services = [] } = useQuery({
    queryKey: ["services", brandId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("services")
        .select("id, name, duration_minutes, default_price, currency")
        .eq("brand_id", brandId)
        .eq("is_active", true)
        .order("name");
      if (error) throw error;
      return data as ServiceRow[];
    },
  });

  const { start: rangeStart, end: rangeEnd } = resolveRange(search);
  const view = search.view;

  const { data: appts = [], isPending: apptsPending } = useQuery({
    queryKey: [
      "appts", brandId, effectiveLocId,
      rangeStart.toISOString(), rangeEnd.toISOString(),
      search.staff, search.service, search.status, search.q,
    ],
    enabled: !!effectiveLocId,
    queryFn: async () => {
      const { select, term } = clientSearch(search.q);

      let q = supabase
        .from("appointments")
        .select(select)
        .eq("brand_id", brandId)
        .eq("location_id", effectiveLocId!)
        .gte("starts_at", rangeStart.toISOString())
        .lt("starts_at", rangeEnd.toISOString());
      q = applyEntityFilters(q, search, { staff: true });
      if (term) {
        q = q.or(`name.ilike.%${term}%,phone.ilike.%${term}%`, { referencedTable: "clients" });
      }

      const { data, error } = await q.order("starts_at");
      if (error) throw error;
      return data as unknown as Appointment[];
    },
  });

  // Every day the range actually covers, not a fixed seven.
  const days = useMemo(() => {
    const out: Date[] = [];
    for (let d = rangeStart; d < rangeEnd; d = addDays(d, 1)) out.push(d);
    return out;
  }, [rangeStart, rangeEnd]);

  // Columns follow the staff filter: filtering to one person should collapse
  // the grid to that person, not leave eight empty columns beside them.
  const selectedStaff = parseList(search.staff);
  const visibleStaff =
    selectedStaff.length > 0 ? staff.filter((s) => selectedStaff.includes(s.user_id)) : staff;

  const staffOptions: MultiSelectOption[] = staff.map((s) => ({
    value: s.user_id,
    label: s.full_name || s.email || "Staff",
  }));
  const serviceOptions: MultiSelectOption[] = services.map((s) => ({
    value: s.id,
    label: s.name,
    hint: `${s.duration_minutes}m`,
  }));

  function shift(days: number) {
    patch({ date: formatDateParam(addDays(rangeStart, days)) });
  }

  return (
    <div className="flex h-screen flex-col">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border bg-background/80 px-4 py-3 backdrop-blur md:px-6">
        <div className="flex items-center gap-2">
          <h1 className="font-display text-xl font-semibold">Appointments</h1>
          <Badge variant="outline" className="ml-2 [overflow-wrap:normal]">
            <CalendarDays aria-hidden className="mr-1 h-3 w-3" />
            <RangeLabel search={search} start={rangeStart} end={rangeEnd} />
          </Badge>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {role === "owner" && locations.length > 1 && (
            <Select value={effectiveLocId ?? ""} onValueChange={(v) => patch({ loc: v })}>
              <SelectTrigger className="h-9 w-48"><SelectValue placeholder="Location" /></SelectTrigger>
              <SelectContent>
                {locations.map((l) => <SelectItem key={l.id} value={l.id}>{l.name}</SelectItem>)}
              </SelectContent>
            </Select>
          )}
          <DateRangeControl search={search} onPatch={patch} />
          {/* Always available. The range never decides the view for you. */}
          <div className="flex rounded-md border border-border p-0.5">
              <button
                type="button"
                aria-pressed={view === "calendar"}
                className={`rounded px-3 py-1 text-xs font-medium transition-colors active:translate-y-px ${view === "calendar" ? "bg-accent text-accent-foreground" : "text-muted-foreground hover:text-foreground"}`}
                onClick={() => patch({ view: "calendar" })}
              >
                Calendar
              </button>
              <button
                type="button"
                aria-pressed={view === "list"}
                className={`rounded px-3 py-1 text-xs font-medium transition-colors active:translate-y-px ${view === "list" ? "bg-accent text-accent-foreground" : "text-muted-foreground hover:text-foreground"}`}
                onClick={() => patch({ view: "list" })}
              >
                List
              </button>
          </div>
          {(search.preset === "day" || search.preset === "week") && (
            <>
              <Button variant="outline" size="icon" aria-label="Previous period" onClick={() => shift(search.preset === "day" ? -1 : -7)}>
                <ChevronLeft aria-hidden className="h-4 w-4" />
              </Button>
              <Button variant="outline" size="icon" aria-label="Next period" onClick={() => shift(search.preset === "day" ? 1 : 7)}>
                <ChevronRight aria-hidden className="h-4 w-4" />
              </Button>
            </>
          )}
          <Button onClick={() => setModal({ open: true })}>
            <Plus aria-hidden className="mr-1 h-4 w-4" /> New
          </Button>
        </div>
      </header>

      <AppointmentFilters
        search={search}
        staffOptions={staffOptions}
        serviceOptions={serviceOptions}
        onPatch={patch}
      />
      <ActiveFilterChips
        search={search}
        staffOptions={staffOptions}
        serviceOptions={serviceOptions}
        resultCount={appts.length}
        onPatch={patch}
        onClearAll={() => patch({ staff: "", service: "", status: "", q: "" })}
      />

      <div className="flex-1 overflow-auto">
        {!effectiveLocId ? (
          <div className="p-10 text-center text-sm text-muted-foreground">No active location.</div>
        ) : apptsPending ? (
          <div className="p-4 md:p-6"><Skeleton className="h-64 w-full" /></div>
        ) : view === "list" ? (
          <ApptListView
            appts={appts}
            staff={staff}
            search={search}
            onApptClick={(a) => setModal({ open: true, edit: a })}
          />
        ) : days.length === 1 ? (
          // A single day is the only range where staff columns make sense —
          // they're the point of the day view. Any wider span becomes day cards.
          <DayGrid
            day={rangeStart}
            staff={visibleStaff}
            appts={appts}
            onSlotClick={(staffId, when) => setModal({ open: true, staffId, when })}
            onApptClick={(a) => setModal({ open: true, edit: a })}
          />
        ) : (
          <DayCardGrid
            days={days}
            appts={appts}
            onDayClick={(d) => patch({ preset: "day", date: formatDateParam(d) })}
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
                <div
                  key={a.id}
                  className={`absolute left-1 right-1 rounded-md border shadow-sm ${statusColor(a.status)}`}
                  style={{ top, height }}
                >
                  <button
                    onClick={() => onApptClick(a)}
                    className="block h-full w-full overflow-hidden p-1.5 pr-6 text-left text-xs"
                  >
                    <ApptCardMini appt={a} />
                  </button>
                  <div className="absolute right-0.5 top-0.5">
                    <StatusMenu appt={a} compact />
                  </div>
                </div>
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

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/**
 * Day-card calendar over whatever range is selected — a week, a month, or an
 * arbitrary custom span.
 *
 * This used to hardcode seven cards, which is why a month range had to be
 * forced into List view: rendering it as a calendar would have silently shown
 * only the first week. Spanning the real range removes the reason for that
 * override, so the view toggle can stay the user's choice.
 *
 * Cards are aligned to weekday columns with leading blanks, so a month reads as
 * a month rather than a run of 31 tiles. Columns start Sunday, matching the
 * week the rest of the product computes (design.md · Place).
 */
function DayCardGrid({
  days, appts, onDayClick,
}: {
  days: Date[];
  appts: Appointment[];
  onDayClick: (d: Date) => void;
}) {
  const leadingBlanks = days.length > 0 ? days[0].getDay() : 0;
  const today = startOfDay(new Date());

  // Bucket once rather than filtering the whole array per card — a month view
  // with a busy diary would otherwise be 31 full passes.
  const byDay = useMemo(() => {
    const m = new Map<string, Appointment[]>();
    for (const a of appts) {
      const k = format(parseISO(a.starts_at), "yyyy-MM-dd");
      const list = m.get(k);
      if (list) list.push(a);
      else m.set(k, [a]);
    }
    return m;
  }, [appts]);

  return (
    <div className="p-3 md:p-4">
      <div className="mb-1 grid grid-cols-7 gap-1.5 md:gap-2">
        {WEEKDAYS.map((w) => (
          <div key={w} className="px-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            {w}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-1.5 md:gap-2">
        {Array.from({ length: leadingBlanks }, (_, i) => (
          <div key={`blank-${i}`} aria-hidden />
        ))}
        {days.map((d) => {
          const dayAppts = byDay.get(format(d, "yyyy-MM-dd")) ?? [];
          const isToday = isSameDay(d, today);
          return (
            <button
              key={d.toISOString()}
              onClick={() => onDayClick(d)}
              className={`min-h-24 rounded-lg border bg-card p-1.5 text-left transition-colors hover:border-accent/50 md:min-h-32 md:p-2 ${
                isToday ? "border-accent" : "border-border"
              }`}
            >
              <div className="mb-1 flex items-baseline justify-between gap-1">
                <span className="tnum text-xs font-medium [overflow-wrap:normal]">{format(d, "d")}</span>
                {dayAppts.length > 0 && (
                  <span className="tnum text-[10px] text-muted-foreground [overflow-wrap:normal]">
                    {dayAppts.length}
                  </span>
                )}
              </div>
              <div className="space-y-0.5">
                {dayAppts.slice(0, 3).map((a) => (
                  <div
                    key={a.id}
                    className={`truncate rounded border px-1 py-0.5 text-[10px] ${statusColor(a.status)}`}
                  >
                    {format(parseISO(a.starts_at), "HH:mm")}
                  </div>
                ))}
                {dayAppts.length > 3 && (
                  <div className="text-[10px] text-muted-foreground">+{dayAppts.length - 3} more</div>
                )}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/**
 * The view a date range implies. A month or a custom span has no calendar-grid
 * representation — staff columns only exist for one day, and the week grid is
 * seven fixed cards — so a range wider than a week renders here instead.
 *
 * Client and service names are resolved in two batched queries rather than the
 * per-card lookups the grid uses: a month of appointments would otherwise fire
 * several hundred requests to render one screen.
 */
function ApptListView({
  appts, staff, search, onApptClick,
}: {
  appts: Appointment[];
  staff: StaffOpt[];
  search: AppointmentSearch;
  onApptClick: (a: Appointment) => void;
}) {
  const clientIds = useMemo(
    () => Array.from(new Set(appts.map((a) => a.client_id))).filter(Boolean),
    [appts],
  );
  const serviceIds = useMemo(
    () => Array.from(new Set(appts.map((a) => a.service_id).filter(Boolean))) as string[],
    [appts],
  );

  const { data: clientsById = {} } = useQuery({
    queryKey: ["appt-list-clients", clientIds],
    enabled: clientIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase.from("clients").select("id, name, phone").in("id", clientIds);
      if (error) throw error;
      return Object.fromEntries((data ?? []).map((c) => [c.id, c])) as Record<string, ClientRow>;
    },
  });
  const { data: servicesById = {} } = useQuery({
    queryKey: ["appt-list-services", serviceIds],
    enabled: serviceIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase.from("services").select("id, name").in("id", serviceIds);
      if (error) throw error;
      return Object.fromEntries((data ?? []).map((s) => [s.id, s])) as Record<string, { id: string; name: string }>;
    },
  });

  const staffById = useMemo(
    () => Object.fromEntries(staff.map((s) => [s.user_id, s])) as Record<string, StaffOpt>,
    [staff],
  );

  // Grouped by day so a month-long range still reads as a diary rather than an
  // undifferentiated wall of rows.
  const byDay = useMemo(() => {
    const groups = new Map<string, Appointment[]>();
    for (const a of appts) {
      const key = format(parseISO(a.starts_at), "yyyy-MM-dd");
      const list = groups.get(key);
      if (list) list.push(a);
      else groups.set(key, [a]);
    }
    return Array.from(groups.entries());
  }, [appts]);

  if (appts.length === 0) {
    return (
      <div className="p-4 md:p-6">
        <Card className="p-10 text-center text-sm text-muted-foreground">
          <EmptyMessage search={search} />
        </Card>
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6">
      <div className="space-y-6">
        {byDay.map(([day, rows]) => (
          <section key={day}>
            <h2 className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {format(parseISO(day), "EEEE, d MMMM yyyy")}
              <span className="tnum ml-2 font-normal normal-case tracking-normal [overflow-wrap:normal]">
                {rows.length}
              </span>
            </h2>
            {/* Hairline grid, not floating cards — the list should read as one
                instrument (design.md · Component voice). */}
            <div className="overflow-hidden rounded-lg border border-border bg-border">
              <div className="grid gap-px">
                {rows.map((a) => {
                  const client = clientsById[a.client_id];
                  const svc = a.service_id ? servicesById[a.service_id] : null;
                  const who = staffById[a.staff_user_id];
                  return (
                    // `min-w-0` is load-bearing: a grid child defaults to
                    // min-width:auto and will not shrink below its content, so
                    // without it the row overflows on a phone and clips the
                    // status menu straight off the screen.
                    <div key={a.id} className="flex min-w-0 items-center gap-2 bg-card px-3 py-2.5 sm:gap-3">
                      <button
                        type="button"
                        onClick={() => onApptClick(a)}
                        className="flex min-w-0 flex-1 items-center gap-2 text-left sm:gap-3"
                      >
                        {/* End time is the first thing to go on a narrow
                            screen — the start time is what staff scan for. */}
                        <span className="tnum shrink-0 text-xs font-medium [overflow-wrap:normal] sm:w-24 sm:text-sm">
                          {format(parseISO(a.starts_at), "HH:mm")}
                          <span className="hidden sm:inline">
                            –{format(parseISO(a.ends_at), "HH:mm")}
                          </span>
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm" dir="auto">
                            {client?.name ?? "Client"}
                          </span>
                          <span className="block truncate text-xs text-muted-foreground" dir="auto">
                            {svc?.name ?? "—"}
                            {who ? ` · ${who.full_name || who.email || "Staff"}` : ""}
                          </span>
                        </span>
                        <span className={`shrink-0 rounded border px-1.5 py-0.5 text-[10px] ${statusColor(a.status)}`}>
                          {a.status.replace("_", " ")}
                        </span>
                        {a.price != null && (
                          <span className="tnum hidden w-24 shrink-0 text-right text-sm [overflow-wrap:normal] sm:block">
                            {formatMoney(a.price, a.currency)}
                          </span>
                        )}
                      </button>
                      <StatusMenu appt={a} />
                    </div>
                  );
                })}
              </div>
            </div>
          </section>
        ))}
      </div>
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
  // Unchecked by default: consent must be affirmative, same rule as the public
  // flow. Staff tick it only when the client has actually agreed.
  const [whatsappOptIn, setWhatsappOptIn] = useState(false);
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

  // Package detection at booking time (Section 11 item 4 asks for both booking
  // and checkout). This records intent only — the session is not debited here.
  // Debiting at booking would burn a session on any appointment later cancelled
  // or no-showed, and would need a reversal path to undo.
  const { data: bookOffers = [] } = useQuery({
    enabled: !!clientId && !!serviceId && !!locationId && !newClientMode,
    queryKey: ["pkg-offers", clientId, serviceId, locationId],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("client_packages_for_service", {
        _brand_id: brandId,
        _client_id: clientId,
        _service_id: serviceId,
        _location_id: locationId,
      });
      if (error) throw error;
      return (data ?? []) as PackageOffer[];
    },
  });

  const [bookUsePackage, setBookUsePackage] = useState(true);
  const bookOffer = bookUsePackage ? (bookOffers[0] ?? null) : null;

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
        // Intent only — checkout pre-selects this and performs the one real
        // decrement. Nothing is debited by writing it here.
        client_package_id: bookOffer?.client_package_id ?? null,
      };
      if (edit) {
        const { error } = await supabase.from("appointments").update(payload).eq("id", edit.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("appointments").insert(payload);
        if (error) throw error;
      }

      // Only ever grants. An unticked box must not revoke a standing preference
      // the client set previously — revoking is the staff toggle or STOP.
      if (whatsappOptIn) {
        const { error: consentErr } = await supabase
          .from("clients")
          .update({
            whatsapp_opt_in: true,
            whatsapp_opt_in_at: new Date().toISOString(),
            whatsapp_consent_source: "staff_booking",
          })
          .eq("id", cid);
        // Consent failing must not fail the booking itself.
        if (consentErr) console.error("[whatsapp] consent write failed", consentErr);
      }
    },
    onSuccess: () => {
      toast.success(edit ? "Appointment updated" : "Appointment booked");
      qc.invalidateQueries({ queryKey: ["appts"] });
      onOpenChange(false);
    },
    onError: (e) => {
      const msg = errorMessage(e, "Failed") ?? "Failed";
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

          {/* Package detected for this client and service. Nothing is used up
              now — this only pre-selects the redemption at checkout, so a
              cancelled booking never costs the client a session. */}
          {bookOffers.length > 0 && (
            <div className="flex items-start gap-2 rounded-md border border-border p-3">
              <Checkbox
                id="book-pkg"
                checked={bookUsePackage}
                onCheckedChange={(v) => setBookUsePackage(v === true)}
              />
              <div className="min-w-0">
                <Label htmlFor="book-pkg" className="text-sm">
                  Redeem from package ({bookOffers[0].remaining_count} of{" "}
                  {bookOffers[0].included_count} remaining)
                </Label>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {bookOffers[0].package_name} · nothing is used until checkout.
                </p>
              </div>
            </div>
          )}

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

          <label
            htmlFor="appt-wa-optin"
            className="flex cursor-pointer items-start gap-3 rounded-md border border-border p-3"
          >
            <Checkbox
              id="appt-wa-optin"
              checked={whatsappOptIn}
              onCheckedChange={(v) => setWhatsappOptIn(v === true)}
              className="mt-0.5"
            />
            <span className="text-sm">
              <span className="font-medium">Client agreed to WhatsApp updates</span>
              <span className="mt-0.5 block text-xs text-muted-foreground">
                Only tick if the client has actually agreed. Saves as a standing
                preference for this client across all their bookings.
              </span>
            </span>
          </label>

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

function StatusMenu({ appt, compact = false }: { appt: Appointment; compact?: boolean }) {
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
    onError: (e) => toast.error(errorMessage(e, "Failed")),
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
          <Button
            variant="ghost"
            size="icon"
            className={compact ? "h-5 w-5 bg-background/70 hover:bg-background" : ""}
            onClick={(e) => e.stopPropagation()}
          >
            <MoreVertical className={compact ? "h-3 w-3" : "h-4 w-4"} />
          </Button>
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

type ProductRow = { id: string; name: string; unit: string };
type ProductUseRow = { product_id: string; quantity: string };

function CompleteDialog({ appt, open, onOpenChange }: { appt: Appointment; open: boolean; onOpenChange: (o: boolean) => void }) {
  const qc = useQueryClient();
  // collected_by is now set server-side from auth.uid() inside appointment_settle,
  // so the dialog no longer needs tenant context.
  const [servicePerformed, setServicePerformed] = useState("");
  const [formulaNotes, setFormulaNotes] = useState("");
  const [amount, setAmount] = useState<string>(appt.price != null ? String(appt.price) : "");
  const [method, setMethod] = useState<"cash" | "card" | "bank_transfer">("cash");
  const [productRows, setProductRows] = useState<ProductUseRow[]>([]);

  // Package redemption — automatic detection with override (Section 11 item 4).
  // Detection only; the session is debited inside appointment_settle so it can
  // never be spent on a checkout that then fails to complete.
  const packagesQuery = useQuery({
    enabled: !!appt.service_id,
    queryKey: ["pkg-offers", appt.client_id, appt.service_id, appt.location_id],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("client_packages_for_service", {
        _brand_id: appt.brand_id,
        _client_id: appt.client_id,
        _service_id: appt.service_id!,
        _location_id: appt.location_id,
      });
      if (error) throw error;
      return (data ?? []) as PackageOffer[];
    },
  });

  // Memoised so the fallback [] keeps a stable identity — otherwise the
  // default-selection effect below re-runs on every render.
  const offers = useMemo(() => packagesQuery.data ?? [], [packagesQuery.data]);
  const [usePackage, setUsePackage] = useState(true);
  const [packageId, setPackageId] = useState<string | null>(null);

  // Default to the package the booking already intended, else the first offer
  // (soonest-expiring, ordered by the RPC). Staff can switch it off entirely.
  useEffect(() => {
    if (packageId || offers.length === 0) return;
    const intended = offers.find((o) => o.client_package_id === appt.client_package_id);
    setPackageId((intended ?? offers[0]).client_package_id);
  }, [offers, appt.client_package_id, packageId]);

  const activeOffer = usePackage ? offers.find((o) => o.client_package_id === packageId) ?? null : null;

  // Gift card redemption. The code is only *checked* here; the actual redeem
  // happens inside appointment_settle so the balance can't be debited for a
  // checkout that then fails to complete.
  const [gcCode, setGcCode] = useState("");
  const [gcInfo, setGcInfo] = useState<GiftCardLookup | null>(null);
  const [gcError, setGcError] = useState<string | null>(null);
  const [gcApply, setGcApply] = useState("");
  const [gcChecking, setGcChecking] = useState(false);

  async function checkGiftCard() {
    const code = gcCode.trim();
    if (!code) return;
    setGcChecking(true);
    setGcError(null);
    setGcInfo(null);
    try {
      const { data, error } = await supabase.rpc("gift_card_lookup", {
        _brand_id: appt.brand_id,
        _code: code,
      });
      if (error) throw error;
      const row = (Array.isArray(data) ? data[0] : data) as GiftCardLookup | undefined;

      if (!row || row.error === "not_found") {
        setGcError("No gift card with that code at this salon. Check the code and try again.");
        return;
      }
      if (row.error) {
        setGcError(
          row.error === "forbidden"
            ? "You don't have permission to use gift cards here."
            : row.error,
        );
        return;
      }
      if (row.effective_status === "expired") {
        setGcError("This gift card has expired and can't be redeemed.");
        setGcInfo(row);
        return;
      }
      if (row.effective_status === "redeemed" || Number(row.remaining_amount) <= 0) {
        setGcError("This gift card has no balance left.");
        setGcInfo(row);
        return;
      }
      if (row.effective_status === "refunded") {
        setGcError("This gift card was refunded and can't be redeemed.");
        setGcInfo(row);
        return;
      }

      setGcInfo(row);
      // Default to whichever is smaller: what's still owed after any package
      // has been applied, or what's on the card. Defaulting to the full price
      // would over-apply the card against a visit the package already covered.
      const due = parseFloat(amount);
      const pkg = activeOffer && Number.isFinite(due) ? Math.min(Number(activeOffer.covers_amount), due) : 0;
      const owed = Number.isFinite(due) ? Math.max(due - pkg, 0) : NaN;
      const bal = Number(row.remaining_amount);
      setGcApply(String(Number.isFinite(owed) && owed > 0 ? Math.min(owed, bal) : bal));
    } catch (e) {
      setGcError(errorMessage(e, "Could not check that code.") ?? "Could not check that code.");
    } finally {
      setGcChecking(false);
    }
  }

  function clearGiftCard() {
    setGcCode("");
    setGcInfo(null);
    setGcError(null);
    setGcApply("");
  }

  const giftUsable = !!gcInfo && !gcError;
  const applyNum = parseFloat(gcApply);
  const dueNum = parseFloat(amount);

  // Settlement order mirrors appointment_settle exactly: package first (it
  // covers a whole service session), then the gift card against what's left,
  // then money collected today. These figures are for display only — the
  // database recomputes every one of them from the same source.
  const packageCovered =
    activeOffer && Number.isFinite(dueNum) ? Math.min(Number(activeOffer.covers_amount), dueNum) : 0;
  const afterPackage = Number.isFinite(dueNum) ? Math.max(dueNum - packageCovered, 0) : dueNum;
  const remainderDue =
    giftUsable && Number.isFinite(applyNum) && Number.isFinite(afterPackage)
      ? Math.max(afterPackage - applyNum, 0)
      : afterPackage;

  const { data: products = [] } = useQuery({
    queryKey: ["products-active", appt.brand_id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("products")
        .select("id, name, unit")
        .eq("brand_id", appt.brand_id)
        .eq("is_active", true)
        .order("name");
      if (error) throw error;
      return data as ProductRow[];
    },
  });

  function updateRow(i: number, patch: Partial<ProductUseRow>) {
    setProductRows((rows) => rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  }
  function addRow() {
    setProductRows((rows) => [...rows, { product_id: "", quantity: "1" }]);
  }
  function removeRow(i: number) {
    setProductRows((rows) => rows.filter((_, idx) => idx !== i));
  }

  const submit = useMutation({
    mutationFn: async () => {
      const amt = parseFloat(amount);
      if (isNaN(amt) || amt < 0) throw new Error("Enter a valid amount");

      // Validate product rows
      const validRows: { product_id: string; quantity: number }[] = [];
      for (const r of productRows) {
        if (!r.product_id) continue;
        const q = parseFloat(r.quantity);
        if (isNaN(q) || q <= 0) throw new Error("Each product row needs a quantity greater than 0");
        validRows.push({ product_id: r.product_id, quantity: q });
      }

      // Upsert service_record (unique on appointment_id) and get id
      let serviceRecordId: string | null = null;
      const { data: srIns, error: srErr } = await supabase.from("service_records").insert({
        appointment_id: appt.id,
        technician_user_id: appt.staff_user_id,
        service_performed: servicePerformed.trim() || "—",
        formula_notes: formulaNotes.trim() || null,
      }).select("id").single();
      if (srErr) {
        if (!srErr.message.toLowerCase().includes("duplicate")) throw srErr;
        const { data: existing, error: exErr } = await supabase
          .from("service_records")
          .select("id")
          .eq("appointment_id", appt.id)
          .maybeSingle();
        if (exErr) throw exErr;
        serviceRecordId = existing?.id ?? null;
      } else {
        serviceRecordId = srIns.id;
      }

      // Insert product usage rows (fires auto_deduct_stock_on_service_use)
      if (validRows.length > 0 && serviceRecordId) {
        const { error: prErr } = await supabase.from("service_record_products").insert(
          validRows.map((r) => ({ service_record_id: serviceRecordId!, product_id: r.product_id, quantity: r.quantity })),
        );
        if (prErr) throw prErr;
      }

      // Money: package redemption, gift card redemption, income, and the status
      // change all happen together inside one transaction. Doing them as
      // separate client-side writes could burn a prepaid session or debit a
      // gift card for a checkout that then failed to finish.
      const useGift = giftUsable && Number.isFinite(applyNum) && applyNum > 0;
      const { data: settled, error: settleErr } = await supabase.rpc("appointment_settle", {
        _appointment_id: appt.id,
        _amount: amt,
        _method: method,
        _gift_card_code: useGift ? gcCode.trim() : undefined,
        _gift_card_amount: useGift ? applyNum : undefined,
        _client_package_id: activeOffer?.client_package_id ?? undefined,
      });
      if (settleErr) throw settleErr;

      const row = Array.isArray(settled) ? settled[0] : settled;
      if (!row || row.error) {
        // Report the real reason rather than a generic failure.
        const map: Record<string, string> = {
          expired: "That gift card has expired and can't be redeemed.",
          not_found: "No gift card with that code at this salon.",
          no_balance: "That gift card has no balance left.",
          refunded: "That gift card was refunded and can't be redeemed.",
          forbidden: "You don't have permission to complete this appointment.",
          invalid_amount: "Enter a valid amount.",
          unknown_appointment: "This appointment no longer exists.",
          already_completed:
            "This appointment was already completed — nothing was charged again.",
          package_expired: "That package has expired and can't be redeemed.",
          package_no_sessions: "That package has no sessions left for this service.",
          package_refunded: "That package was refunded and can't be redeemed.",
          package_wrong_client: "That package belongs to a different client.",
          package_not_found: "That package no longer exists.",
          package_service_not_covered: "That package doesn't cover this service.",
        };
        throw new Error(map[row?.error ?? ""] ?? row?.error ?? "Could not complete the appointment.");
      }
      return row as {
        package_covered: number | null;
        package_remaining: number | null;
        gift_applied: number | null;
        gift_remaining: number | null;
        cash_amount: number | null;
      };
    },
    onSuccess: (res) => {
      const applied = Number(res?.gift_applied ?? 0);
      const covered = Number(res?.package_covered ?? 0);
      const parts: string[] = [];
      if (covered > 0) {
        parts.push(
          `Package covered ${covered.toFixed(2)} ${appt.currency} · ${Number(res?.package_remaining ?? 0)} session${Number(res?.package_remaining ?? 0) === 1 ? "" : "s"} left.`,
        );
      }
      if (applied > 0) {
        parts.push(
          `Gift card covered ${applied.toFixed(2)} ${appt.currency}. Remaining on card: ${Number(res?.gift_remaining ?? 0).toFixed(2)} ${appt.currency}.`,
        );
      }
      toast.success("Appointment completed", {
        description: parts.length > 0 ? parts.join(" ") : undefined,
      });
      qc.invalidateQueries({ queryKey: ["gift-cards"] });
      qc.invalidateQueries({ queryKey: ["client-packages"] });
      qc.invalidateQueries({ queryKey: ["pkg-offers"] });
      qc.invalidateQueries({ queryKey: ["appts"] });
      qc.invalidateQueries({ queryKey: ["my-appts"] });
      qc.invalidateQueries({ queryKey: ["location-stock"] });
      qc.invalidateQueries({ queryKey: ["stock-movements"] });
      onOpenChange(false);
    },
    onError: (e) => toast.error(errorMessage(e, "Failed")),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Complete appointment</DialogTitle>
          <DialogDescription>Log what was done, products used, and payment collected.</DialogDescription>
        </DialogHeader>
        <div className="max-h-[70vh] space-y-3 overflow-y-auto pr-1">
          <div className="space-y-1.5">
            <Label>Service performed / notes (optional)</Label>
            <Input dir="auto" value={servicePerformed} onChange={(e) => setServicePerformed(e.target.value)} placeholder="e.g. Balayage, root touch-up" />
          </div>
          <div className="space-y-1.5">
            <Label>Formula / technician notes (optional)</Label>
            <Textarea dir="auto" value={formulaNotes} onChange={(e) => setFormulaNotes(e.target.value)} rows={2} placeholder="Formula details, mix ratios…" />
          </div>

          <div className="space-y-2 rounded-md border border-border p-3">
            <div className="flex items-center justify-between">
              <Label className="text-sm">Products used (optional)</Label>
              <Button type="button" variant="outline" size="sm" onClick={addRow}>
                <Plus className="mr-1 h-3 w-3" /> Add product
              </Button>
            </div>
            {productRows.length === 0 && (
              <p className="text-xs text-muted-foreground">No products logged. Add rows for any stock items consumed.</p>
            )}
            {productRows.map((row, i) => {
              const prod = products.find((p) => p.id === row.product_id);
              return (
                <div key={i} className="flex items-end gap-2">
                  <div className="flex-1 space-y-1">
                    <Label className="text-xs">Product</Label>
                    <Select value={row.product_id} onValueChange={(v) => updateRow(i, { product_id: v })}>
                      <SelectTrigger><SelectValue placeholder="Select product" /></SelectTrigger>
                      <SelectContent>
                        {products.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="w-28 space-y-1">
                    <Label className="text-xs">Qty {prod ? `(${prod.unit})` : ""}</Label>
                    <Input type="number" step="0.01" min="0" value={row.quantity} onChange={(e) => updateRow(i, { quantity: e.target.value })} />
                  </div>
                  <Button type="button" variant="ghost" size="sm" onClick={() => removeRow(i)}>Remove</Button>
                </div>
              );
            })}
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

          {/* Package. Detected automatically and switched on by default when
              the client has sessions left for this service (Section 11 item 4),
              but always overridable — the client may prefer to pay today and
              keep the session for later. */}
          {offers.length > 0 && (
            <div className="space-y-2 rounded-md border border-border p-3">
              <div className="flex items-start gap-2">
                <Checkbox
                  id="pkg-use"
                  checked={usePackage}
                  onCheckedChange={(v) => setUsePackage(v === true)}
                />
                <div className="min-w-0 flex-1">
                  <Label htmlFor="pkg-use" className="text-sm">
                    Redeem from package
                    {activeOffer
                      ? ` (${activeOffer.remaining_count} of ${activeOffer.included_count} remaining)`
                      : ""}
                  </Label>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {activeOffer
                      ? `${activeOffer.package_name} · covers ${packageCovered.toFixed(2)} ${appt.currency} of this visit`
                      : "Paying normally — no session will be used."}
                  </p>
                </div>
              </div>

              {/* Only shown when it's a real choice. */}
              {usePackage && offers.length > 1 && (
                <div className="space-y-1">
                  <Label className="text-xs">Which package</Label>
                  <Select value={packageId ?? ""} onValueChange={setPackageId}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {offers.map((o) => (
                        <SelectItem key={o.client_package_id} value={o.client_package_id}>
                          {o.package_name} · {o.remaining_count} of {o.included_count} left
                          {o.expires_at
                            ? ` · expires ${format(parseISO(o.expires_at), "d MMM yyyy")}`
                            : ""}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}

              {usePackage && activeOffer && (
                <p className="text-xs text-muted-foreground">
                  Still to pay after the package:{" "}
                  <span className="font-medium text-foreground">
                    {Number.isFinite(afterPackage) ? afterPackage.toFixed(2) : "—"} {appt.currency}
                  </span>
                </p>
              )}
            </div>
          )}

          {/* Gift card. Partial redemption is the normal case, so this shows
              what the card covers and what is still owed by other means. */}
          <div className="space-y-2 rounded-md border border-border p-3">
            <Label className="text-sm">Gift card (optional)</Label>
            {!gcInfo ? (
              <div className="flex items-end gap-2">
                <div className="flex-1 space-y-1">
                  <Label htmlFor="gc-redeem-code" className="text-xs">Code</Label>
                  <Input
                    id="gc-redeem-code"
                    value={gcCode}
                    onChange={(e) => setGcCode(e.target.value)}
                    placeholder="XXXX-XXXX"
                    className="font-mono uppercase"
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        checkGiftCard();
                      }
                    }}
                  />
                </div>
                <Button
                  type="button"
                  variant="outline"
                  onClick={checkGiftCard}
                  disabled={gcChecking || !gcCode.trim()}
                >
                  {gcChecking ? "Checking…" : "Check"}
                </Button>
              </div>
            ) : (
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <code className="font-mono text-sm">{gcInfo.code}</code>
                  <Button type="button" variant="ghost" size="sm" onClick={clearGiftCard}>
                    Remove
                  </Button>
                </div>
                {!gcError && (
                  <>
                    <p className="text-xs text-muted-foreground">
                      Balance {Number(gcInfo.remaining_amount).toFixed(2)} {gcInfo.currency}
                      {gcInfo.expires_at
                        ? ` · expires ${format(parseISO(gcInfo.expires_at), "d MMM yyyy")}`
                        : " · no expiry"}
                    </p>
                    <div className="space-y-1">
                      <Label htmlFor="gc-apply" className="text-xs">
                        Apply from card ({appt.currency})
                      </Label>
                      <Input
                        id="gc-apply"
                        type="number"
                        step="0.01"
                        min="0"
                        value={gcApply}
                        onChange={(e) => setGcApply(e.target.value)}
                      />
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Still to pay by {method.replace("_", " ")}:{" "}
                      <span className="font-medium text-foreground">
                        {Number.isFinite(remainderDue) ? remainderDue.toFixed(2) : "—"}{" "}
                        {appt.currency}
                      </span>
                    </p>
                  </>
                )}
              </div>
            )}
            {gcError && (
              <p className="text-xs text-amber-700">{gcError}</p>
            )}
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

