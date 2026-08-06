/**
 * Staff profile — /app/staff/$id
 *
 * Stat-Led per design.md: the numbers this person produced come first, and
 * everything below qualifies them. Motion-cut, hairline stat grid, rose gold on
 * exactly one primary action (Transfer).
 *
 * Role gating is layered, and the layers do different jobs:
 *   - RLS is the enforcement. A Receptionist querying staff_personal_details
 *     gets zero rows no matter what this file does.
 *   - can_view_staff_pii() decides whether the section RENDERS. It is the same
 *     function the four RLS policies call, so the UI and the database can never
 *     disagree about who may see a QID. Deriving the answer here from
 *     tenant.roles would have been a second implementation of the rule — which
 *     is how the deposit-rounding bug happened (Section 9, UX fix #4).
 *
 * The personal-details section is absent for anyone who fails that check, not
 * present-and-disabled: a disabled field still tells a Receptionist that a
 * colleague has a national ID on file, and the field labels alone leak the
 * shape of the record.
 */
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { format, parseISO } from "date-fns";
import { ArrowLeft, ArrowRightLeft, ImagePlus, MapPin } from "lucide-react";
import { toast } from "sonner";

import { errorMessage } from "@/lib/error-message";
import { formatMoney } from "@/lib/money";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/hooks/use-tenant";
import { AppShell } from "@/components/app-shell";
import { WeeklyHours, LeaveSection } from "@/components/staff-schedule-sections";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
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

export const Route = createFileRoute("/_authenticated/app/staff/$id/")({
  head: () => ({
    meta: [{ title: "Staff profile — Q-Salon Suite" }, { name: "robots", content: "noindex" }],
  }),
  component: StaffProfileRoute,
});

type LocationRow = { id: string; name: string };
type HistoryRow = {
  id: string;
  location_id: string;
  started_at: string;
  ended_at: string | null;
};
type PersonalDetails = {
  user_id: string;
  date_of_birth: string | null;
  national_id: string | null;
  home_address: string | null;
  emergency_contact_name: string | null;
  emergency_contact_phone: string | null;
  nationality: string | null;
  hire_date: string | null;
};

function StaffProfileRoute() {
  const tenant = useTenant();
  const { id: staffUserId } = Route.useParams();
  const navigate = useNavigate();

  if (tenant.isLoading) {
    return (
      <AppShell>
        <div className="p-8">
          <Skeleton className="h-96" />
        </div>
      </AppShell>
    );
  }
  if (!tenant.data?.brandId) return <AppShell>{null}</AppShell>;

  return (
    <AppShell>
      <div className="p-6 md:p-8">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => navigate({ to: "/app/staff" })}
          className="mb-4 whitespace-nowrap"
        >
          <ArrowLeft className="mr-1 h-4 w-4" aria-hidden="true" /> Back to staff
        </Button>
        <ProfileBody staffUserId={staffUserId} />
      </div>
    </AppShell>
  );
}

function ProfileBody({ staffUserId }: { staffUserId: string }) {
  const tenant = useTenant();
  const brandId = tenant.data!.brandId!;
  const viewerId = tenant.data!.userId!;
  const viewerRole = tenant.data!.primaryRole;
  const viewerLocation = tenant.data!.locationId;
  const canManage = viewerRole === "owner" || viewerRole === "manager";

  const { data: person } = useQuery({
    queryKey: ["staff-person", staffUserId],
    queryFn: async () => {
      const { data } = await supabase
        .from("profiles")
        .select("full_name, email")
        .eq("id", staffUserId)
        .maybeSingle();
      return data;
    },
  });

  const { data: staffRole } = useQuery({
    queryKey: ["staff-role", staffUserId, brandId],
    queryFn: async () => {
      const { data } = await supabase
        .from("user_roles")
        .select("role, location_id")
        .eq("user_id", staffUserId)
        .eq("brand_id", brandId)
        .maybeSingle();
      return data as { role: string; location_id: string | null } | null;
    },
  });

  const { data: locations = [] } = useQuery({
    queryKey: ["locations", brandId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("locations")
        .select("id, name")
        .eq("brand_id", brandId)
        .eq("is_active", true)
        .order("name");
      if (error) throw error;
      return data as LocationRow[];
    },
  });

  // The same predicate the RLS policies use. One source of truth for "who may
  // see a QID", queried rather than re-derived.
  const { data: canViewPii = false, isLoading: piiGateLoading } = useQuery({
    queryKey: ["can-view-pii", viewerId, staffUserId],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("can_view_staff_pii", {
        _actor: viewerId,
        _staff_user_id: staffUserId,
      });
      if (error) throw error;
      return Boolean(data);
    },
  });

  const locName = useMemo(
    () => Object.fromEntries(locations.map((l) => [l.id, l.name])),
    [locations],
  );

  return (
    <div className="space-y-6">
      <ProfileHeader
        staffUserId={staffUserId}
        brandId={brandId}
        name={person?.full_name || person?.email || "Staff member"}
        role={staffRole?.role ?? null}
        locationName={staffRole?.location_id ? locName[staffRole.location_id] : null}
        canManage={canManage}
        canViewPii={canViewPii}
      />

      <PerformanceByLocation staffUserId={staffUserId} brandId={brandId} locName={locName} />

      {piiGateLoading ? (
        <Skeleton className="h-48" />
      ) : canViewPii ? (
        <PersonalDetailsSection staffUserId={staffUserId} />
      ) : null}

      <LocationSection
        staffUserId={staffUserId}
        brandId={brandId}
        locations={locations}
        locName={locName}
        currentLocationId={staffRole?.location_id ?? null}
        viewerRole={viewerRole}
        viewerLocation={viewerLocation}
        // Mirrors the SELECT policy on staff_location_history. Without it a
        // Receptionist is told "No location history recorded" when the truth is
        // "you may not see it" — an empty state that quietly asserts something
        // false about the data.
        canSeeHistory={
          viewerRole === "owner" || viewerRole === "manager" || viewerId === staffUserId
        }
      />

      {staffRole?.location_id && (
        <>
          <WeeklyHours
            userId={staffUserId}
            locationId={staffRole.location_id}
            readOnly={!canManage}
          />
          <LeaveSection
            userId={staffUserId}
            locationId={staffRole.location_id}
            readOnly={!canManage}
          />
        </>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------- header --- */

function ProfileHeader({
  staffUserId,
  brandId,
  name,
  role,
  locationName,
  canManage,
  canViewPii,
}: {
  staffUserId: string;
  brandId: string;
  name: string;
  role: string | null;
  locationName: string | null;
  canManage: boolean;
  canViewPii: boolean;
}) {
  const qc = useQueryClient();
  const [signedUrl, setSignedUrl] = useState<string | null>(null);

  const { data: photo } = useQuery({
    queryKey: ["staff-photo", staffUserId],
    queryFn: async () => {
      const { data } = await supabase
        .from("staff_photos")
        .select("photo_path")
        .eq("user_id", staffUserId)
        .maybeSingle();
      return data as { photo_path: string } | null;
    },
  });

  // The bucket is private, so a path is not a src. Mint a short-lived signed URL
  // at render time; persisting one would persist something that stops working.
  useEffect(() => {
    let cancelled = false;
    if (!photo?.photo_path) {
      setSignedUrl(null);
      return;
    }
    supabase.storage
      .from("staff-photos")
      .createSignedUrl(photo.photo_path, 3600)
      .then(({ data }) => {
        if (!cancelled) setSignedUrl(data?.signedUrl ?? null);
      });
    return () => {
      cancelled = true;
    };
  }, [photo?.photo_path]);

  // Hire date lives on the restricted table, so it is only ever fetched for
  // someone already cleared to read it.
  const { data: hire } = useQuery({
    queryKey: ["staff-hire-date", staffUserId],
    enabled: canViewPii,
    queryFn: async () => {
      const { data } = await supabase
        .from("staff_personal_details")
        .select("hire_date")
        .eq("user_id", staffUserId)
        .maybeSingle();
      return data as { hire_date: string | null } | null;
    },
  });

  const upload = useMutation({
    mutationFn: async (file: File) => {
      const ext = file.name.split(".").pop()?.toLowerCase() ?? "jpg";
      // {brand_id}/{user_id} — brand first, because the storage policies parse
      // the first path segment to decide who may read or write the object.
      const path = `${brandId}/${staffUserId}.${ext}`;
      const { error: upErr } = await supabase.storage
        .from("staff-photos")
        .upload(path, file, { upsert: true, contentType: file.type });
      if (upErr) throw upErr;
      const { error: rowErr } = await supabase.from("staff_photos").upsert({
        user_id: staffUserId,
        brand_id: brandId,
        photo_path: path,
        updated_at: new Date().toISOString(),
      });
      if (rowErr) throw rowErr;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["staff-photo", staffUserId] });
      toast.success("Photo updated");
    },
    onError: (e) => toast.error(errorMessage(e, "Upload failed")),
  });

  const initials = name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0])
    .join("")
    .toUpperCase();

  return (
    <div className="flex flex-wrap items-center gap-4 border-b border-border pb-6">
      <div className="relative">
        {signedUrl ? (
          <img
            src={signedUrl}
            alt=""
            className="h-20 w-20 rounded-full border border-border object-cover"
          />
        ) : (
          <div
            className="flex h-20 w-20 items-center justify-center rounded-full border border-border bg-muted font-display text-2xl text-muted-foreground"
            aria-hidden="true"
          >
            {initials || "—"}
          </div>
        )}
      </div>

      <div className="min-w-0 flex-1">
        <h1 className="font-display text-2xl font-semibold [overflow-wrap:anywhere]" dir="auto">
          {name}
        </h1>
        <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
          {role && <Badge variant="outline">{role}</Badge>}
          {locationName && (
            <span className="inline-flex items-center gap-1">
              <MapPin className="h-3 w-3" aria-hidden="true" />
              {locationName}
            </span>
          )}
          {hire?.hire_date && (
            <span className="tnum [overflow-wrap:normal]">
              Joined {format(parseISO(hire.hire_date), "MMM yyyy")}
            </span>
          )}
        </div>
      </div>

      {canManage && (
        <div>
          <input
            id="staff-photo-input"
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className="sr-only"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) upload.mutate(f);
              e.target.value = "";
            }}
          />
          <Button variant="outline" size="sm" asChild disabled={upload.isPending}>
            <label htmlFor="staff-photo-input" className="cursor-pointer whitespace-nowrap">
              <ImagePlus className="mr-1 h-4 w-4" aria-hidden="true" />
              {photo ? "Replace photo" : "Add photo"}
            </label>
          </Button>
        </div>
      )}
    </div>
  );
}

/* ----------------------------------------------------------- performance --- */

function PerformanceByLocation({
  staffUserId,
  brandId,
  locName,
}: {
  staffUserId: string;
  brandId: string;
  locName: Record<string, string>;
}) {
  const q = useQuery({
    queryKey: ["staff-perf", staffUserId, brandId],
    queryFn: async () => {
      // Grouped by the appointment's OWN location_id, not by where the staff
      // member currently sits. Work done at a branch they have since left still
      // belongs to that branch — which is exactly why this does not consult
      // staff_location_history.
      const { data: appts, error: aErr } = await supabase
        .from("appointments")
        .select("id, location_id, status")
        .eq("brand_id", brandId)
        .eq("staff_user_id", staffUserId);
      if (aErr) throw aErr;

      const { data: income, error: iErr } = await supabase
        .from("income_records")
        .select("amount, currency, appointment_id")
        .eq("brand_id", brandId);
      if (iErr) throw iErr;

      const byAppt = new Map((appts ?? []).map((a) => [a.id, a]));
      const revenue = new Map<string, number>();
      let currency = "QAR";
      for (const r of income ?? []) {
        if (!r.appointment_id) continue;
        const a = byAppt.get(r.appointment_id);
        if (!a) continue;
        currency = r.currency ?? currency;
        revenue.set(a.location_id, (revenue.get(a.location_id) ?? 0) + Number(r.amount));
      }

      const per = new Map<string, { completed: number; noShow: number; nonCancelled: number }>();
      for (const a of appts ?? []) {
        const cur = per.get(a.location_id) ?? { completed: 0, noShow: 0, nonCancelled: 0 };
        if (a.status !== "cancelled") cur.nonCancelled += 1;
        if (a.status === "completed") cur.completed += 1;
        if (a.status === "no_show") cur.noShow += 1;
        per.set(a.location_id, cur);
      }

      const rows = [...per.entries()].map(([locationId, s]) => ({
        locationId,
        completed: s.completed,
        revenue: revenue.get(locationId) ?? 0,
        noShowRate: s.nonCancelled > 0 ? s.noShow / s.nonCancelled : 0,
      }));
      rows.sort((a, b) => b.revenue - a.revenue);

      const totals = rows.reduce(
        (t, r) => ({ completed: t.completed + r.completed, revenue: t.revenue + r.revenue }),
        { completed: 0, revenue: 0 },
      );
      return { rows, totals, currency };
    },
  });

  if (q.isLoading) return <Skeleton className="h-40" />;
  const data = q.data;
  if (!data || data.rows.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="font-display text-lg">Performance</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          Nothing on the book for this colleague yet.
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {/* Hairline grid, not floating cards — the dashboard reads as one instrument. */}
      {/* One column below sm. A two-up grid at 320px leaves ~140px per cell,
          which a nowrap currency figure overflows — and design.md forbids both
          wrapping the figure and scrolling the page sideways to read it. */}
      <div className="grid grid-cols-1 gap-px overflow-hidden rounded-lg border border-border bg-border sm:grid-cols-3">
        <Stat label="Appointments completed" value={String(data.totals.completed)} />
        <Stat label="Revenue" value={formatMoney(data.totals.revenue, data.currency)} />
        <Stat label="Locations worked" value={String(data.rows.length)} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="font-display text-lg">By location</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Location</TableHead>
                <TableHead className="text-right">Completed</TableHead>
                <TableHead className="text-right">Revenue</TableHead>
                <TableHead className="text-right">No-show rate</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.rows.map((r) => (
                <TableRow key={r.locationId}>
                  <TableCell>{locName[r.locationId] ?? "—"}</TableCell>
                  <TableCell className="text-right tnum [overflow-wrap:normal]">
                    {r.completed}
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-right tnum [overflow-wrap:normal]">
                    {formatMoney(r.revenue, data.currency)}
                  </TableCell>
                  <TableCell className="text-right tnum [overflow-wrap:normal]">
                    {(r.noShowRate * 100).toFixed(0)}%
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-background p-4">
      <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
      {/* design.md: a figure is never allowed to wrap. [overflow-wrap:normal]
          stops it breaking mid-number, but "1,018.16 QAR" was still breaking at
          the space before the currency, which reads as two figures. nowrap plus
          a smaller base size keeps it on one line down to 320px. */}
      <div className="mt-1 whitespace-nowrap font-display text-xl tnum [overflow-wrap:normal] sm:text-2xl">
        {value}
      </div>
    </div>
  );
}

/* ------------------------------------------------------ personal details --- */

const PII_FIELDS: { key: keyof PersonalDetails; label: string; type?: string }[] = [
  { key: "date_of_birth", label: "Date of birth", type: "date" },
  { key: "national_id", label: "QID / national ID" },
  { key: "nationality", label: "Nationality" },
  { key: "home_address", label: "Home address" },
  { key: "emergency_contact_name", label: "Emergency contact" },
  { key: "emergency_contact_phone", label: "Emergency phone" },
  { key: "hire_date", label: "Hire date", type: "date" },
];

function PersonalDetailsSection({ staffUserId }: { staffUserId: string }) {
  const qc = useQueryClient();
  const [draft, setDraft] = useState<Partial<PersonalDetails>>({});
  const [dirty, setDirty] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ["staff-pii", staffUserId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("staff_personal_details")
        .select("*")
        .eq("user_id", staffUserId)
        .maybeSingle();
      if (error) throw error;
      return (data ?? null) as PersonalDetails | null;
    },
  });

  useEffect(() => {
    setDraft(data ?? {});
    setDirty(false);
  }, [data]);

  const save = useMutation({
    mutationFn: async () => {
      const payload = { ...draft, user_id: staffUserId };
      // Empty strings become NULL: a blank QID field means "not recorded", not
      // "recorded as nothing".
      for (const k of Object.keys(payload) as (keyof PersonalDetails)[]) {
        if (payload[k] === "") (payload as Record<string, unknown>)[k] = null;
      }
      const { error } = await supabase.from("staff_personal_details").upsert(payload);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["staff-pii", staffUserId] });
      qc.invalidateQueries({ queryKey: ["staff-hire-date", staffUserId] });
      setDirty(false);
      toast.success("Personal details saved");
    },
    onError: (e) => toast.error(errorMessage(e, "Save failed")),
  });

  function set(key: keyof PersonalDetails, value: string) {
    setDraft((d) => ({ ...d, [key]: value }));
    setDirty(true);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="font-display text-lg">Personal details</CardTitle>
        <p className="text-sm text-muted-foreground">
          Visible to the owner and this location&rsquo;s manager only. Not shown to reception or
          other staff.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading ? (
          <Skeleton className="h-40" />
        ) : (
          <>
            <div className="grid gap-4 sm:grid-cols-2">
              {PII_FIELDS.map((f) => (
                <div key={f.key} className="space-y-1">
                  <Label htmlFor={`pii-${f.key}`} className="text-xs">
                    {f.label}
                  </Label>
                  <Input
                    id={`pii-${f.key}`}
                    type={f.type ?? "text"}
                    dir="auto"
                    value={(draft[f.key] as string) ?? ""}
                    onChange={(e) => set(f.key, e.target.value)}
                  />
                </div>
              ))}
            </div>
            <Button
              variant="outline"
              onClick={() => save.mutate()}
              disabled={!dirty || save.isPending}
            >
              {save.isPending ? "Saving…" : "Save details"}
            </Button>
          </>
        )}
      </CardContent>
    </Card>
  );
}

/* ---------------------------------------------------------- location tab --- */

function LocationSection({
  staffUserId,
  brandId,
  locations,
  locName,
  currentLocationId,
  viewerRole,
  viewerLocation,
  canSeeHistory,
}: {
  staffUserId: string;
  brandId: string;
  locations: LocationRow[];
  locName: Record<string, string>;
  currentLocationId: string | null;
  viewerRole: string | null;
  viewerLocation: string | null;
  canSeeHistory: boolean;
}) {
  const qc = useQueryClient();
  const [target, setTarget] = useState<string>("");

  const { data: history = [] } = useQuery({
    enabled: canSeeHistory,
    queryKey: ["staff-loc-history", staffUserId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("staff_location_history")
        .select("id, location_id, started_at, ended_at")
        .eq("user_id", staffUserId)
        .order("started_at", { ascending: false });
      if (error) throw error;
      return data as HistoryRow[];
    },
  });

  // Owner may send someone anywhere in the brand. A Manager may only pull
  // someone INTO a location they run — mirroring transfer_staff_location, which
  // is the thing that actually enforces it.
  const targets = useMemo(() => {
    if (viewerRole === "owner") return locations.filter((l) => l.id !== currentLocationId);
    if (viewerRole === "manager" && viewerLocation)
      return locations.filter((l) => l.id === viewerLocation && l.id !== currentLocationId);
    return [];
  }, [viewerRole, viewerLocation, locations, currentLocationId]);

  const transfer = useMutation({
    mutationFn: async () => {
      if (!target) throw new Error("Choose a location");
      const { data, error } = await supabase.rpc("transfer_staff_location", {
        _staff_user_id: staffUserId,
        _new_location_id: target,
      });
      if (error) throw error;
      const row = Array.isArray(data) ? data[0] : data;
      if (!row?.ok) {
        // Surface the real reason. A generic "failed" here would hide exactly
        // the cases worth knowing about — a manager reaching past their branch,
        // or a stale roster.
        const reason =
          {
            not_permitted: "You can only move staff into a location you manage.",
            no_change: "They are already at that location.",
            not_staff_in_brand: "That colleague has no staff role at this brand.",
            location_not_found: "That location is not active.",
            not_authenticated: "Your session expired — sign in again.",
          }[row?.outcome as string] ?? `Transfer refused (${row?.outcome ?? "unknown"}).`;
        throw new Error(reason);
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["staff-loc-history", staffUserId] });
      qc.invalidateQueries({ queryKey: ["staff-role", staffUserId, brandId] });
      qc.invalidateQueries({ queryKey: ["tenant-context"] });
      setTarget("");
      toast.success("Transferred", {
        description: "Working hours are set per location — check their schedule at the new branch.",
      });
    },
    onError: (e) => toast.error(errorMessage(e, "Transfer failed")),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="font-display text-lg">Location</CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="text-sm">
          <span className="text-muted-foreground">Currently at </span>
          <span className="font-medium">
            {currentLocationId ? (locName[currentLocationId] ?? "—") : "Not assigned"}
          </span>
        </div>

        {targets.length > 0 && (
          <div className="flex flex-wrap items-end gap-2 rounded-md border border-dashed border-border p-3">
            <div className="min-w-52 space-y-1">
              <Label className="text-xs">Transfer to</Label>
              <Select value={target} onValueChange={setTarget}>
                <SelectTrigger>
                  <SelectValue placeholder="Choose a location" />
                </SelectTrigger>
                <SelectContent>
                  {targets.map((l) => (
                    <SelectItem key={l.id} value={l.id}>
                      {l.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button
              onClick={() => transfer.mutate()}
              disabled={!target || transfer.isPending}
              className="whitespace-nowrap"
            >
              <ArrowRightLeft className="mr-1 h-4 w-4" aria-hidden="true" />
              {transfer.isPending ? "Transferring…" : "Transfer"}
            </Button>
          </div>
        )}

        {canSeeHistory && (
          <div>
            <div className="mb-2 text-xs uppercase tracking-wide text-muted-foreground">
              History
            </div>
            {history.length === 0 ? (
              <div className="text-sm text-muted-foreground">No location history recorded.</div>
            ) : (
              <ul className="space-y-1">
                {history.map((h) => (
                  <li
                    key={h.id}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border px-3 py-2 text-sm"
                  >
                    <span className="font-medium">{locName[h.location_id] ?? "—"}</span>
                    <span className="tnum [overflow-wrap:normal] text-muted-foreground">
                      {format(parseISO(h.started_at), "MMM yyyy")} –{" "}
                      {h.ended_at ? format(parseISO(h.ended_at), "MMM yyyy") : "present"}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
