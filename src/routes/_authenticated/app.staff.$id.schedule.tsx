import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { format, parseISO } from "date-fns";
import { ArrowLeft, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/hooks/use-tenant";
import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export const Route = createFileRoute("/_authenticated/app/staff/$id/schedule")({
  head: () => ({
    meta: [{ title: "Staff schedule — Q-Salon Suite" }, { name: "robots", content: "noindex" }],
  }),
  component: SchedulePage,
});

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

type ScheduleRow = { id: string; user_id: string; location_id: string; day_of_week: number; start_time: string; end_time: string };
type LeaveRow = { id: string; user_id: string; location_id: string | null; start_date: string; end_date: string; reason: string | null };
type LocationRow = { id: string; name: string };

function SchedulePage() {
  const tenant = useTenant();
  const { id: staffUserId } = Route.useParams();
  const navigate = useNavigate();

  if (tenant.isLoading) return <AppShell><div className="p-8"><Skeleton className="h-96" /></div></AppShell>;
  if (!tenant.data?.brandId) return <AppShell>{null}</AppShell>;

  const role = tenant.data.primaryRole;
  const canEdit = role === "owner" || role === "manager";
  const isSelf = tenant.data.userId === staffUserId;

  if (!canEdit && !isSelf) {
    return (
      <AppShell>
        <div className="p-8">
          <h1 className="font-display text-2xl font-semibold">Not available</h1>
          <p className="mt-2 text-sm text-muted-foreground">You can only view your own schedule.</p>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <div className="p-6 md:p-8">
        <Button variant="ghost" size="sm" onClick={() => navigate({ to: "/app/staff" })} className="mb-4">
          <ArrowLeft className="mr-1 h-4 w-4" /> Back to staff
        </Button>
        <ScheduleContent staffUserId={staffUserId} readOnly={!canEdit} />
      </div>
    </AppShell>
  );
}

function ScheduleContent({ staffUserId, readOnly }: { staffUserId: string; readOnly: boolean }) {
  const tenant = useTenant();
  const brandId = tenant.data!.brandId!;

  const { data: person } = useQuery({
    queryKey: ["staff-person", staffUserId],
    queryFn: async () => {
      const { data } = await supabase.from("profiles").select("full_name, email").eq("id", staffUserId).maybeSingle();
      return data;
    },
  });

  const { data: locations = [] } = useQuery({
    queryKey: ["locations", brandId],
    queryFn: async () => {
      const { data, error } = await supabase.from("locations").select("id, name").eq("brand_id", brandId).eq("is_active", true).order("name");
      if (error) throw error;
      return data as LocationRow[];
    },
  });

  const { data: role } = useQuery({
    queryKey: ["staff-role", staffUserId, brandId],
    queryFn: async () => {
      const { data } = await supabase.from("user_roles").select("role, location_id").eq("user_id", staffUserId).eq("brand_id", brandId).maybeSingle();
      return data as { role: string; location_id: string | null } | null;
    },
  });

  const [locationId, setLocationId] = useState<string | null>(null);
  const effectiveLocId = locationId ?? role?.location_id ?? locations[0]?.id ?? null;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-2xl font-semibold">{person?.full_name || person?.email || "Staff schedule"}</h1>
        <p className="text-sm text-muted-foreground">Weekly working hours and leave.</p>
      </div>

      {locations.length > 1 && (
        <div className="flex items-center gap-2">
          <Label>Location</Label>
          <Select value={effectiveLocId ?? ""} onValueChange={setLocationId}>
            <SelectTrigger className="w-56"><SelectValue /></SelectTrigger>
            <SelectContent>
              {locations.map((l) => <SelectItem key={l.id} value={l.id}>{l.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      )}

      {effectiveLocId && <WeeklyHours userId={staffUserId} locationId={effectiveLocId} readOnly={readOnly} />}
      {effectiveLocId && <LeaveSection userId={staffUserId} locationId={effectiveLocId} readOnly={readOnly} />}
    </div>
  );
}

function WeeklyHours({ userId, locationId, readOnly }: { userId: string; locationId: string; readOnly: boolean }) {
  const qc = useQueryClient();
  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["sched", userId, locationId],
    queryFn: async () => {
      const { data, error } = await supabase.from("staff_schedules").select("*").eq("user_id", userId).eq("location_id", locationId).order("day_of_week");
      if (error) throw error;
      return data as ScheduleRow[];
    },
  });

  const upsert = useMutation({
    mutationFn: async (input: { day: number; start: string; end: string; enabled: boolean }) => {
      const existing = rows.find((r) => r.day_of_week === input.day);
      if (!input.enabled) {
        if (existing) {
          const { error } = await supabase.from("staff_schedules").delete().eq("id", existing.id);
          if (error) throw error;
        }
        return;
      }
      if (existing) {
        const { error } = await supabase.from("staff_schedules").update({ start_time: input.start, end_time: input.end }).eq("id", existing.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("staff_schedules").insert({ user_id: userId, location_id: locationId, day_of_week: input.day, start_time: input.start, end_time: input.end });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["sched", userId, locationId] });
      toast.success("Schedule saved");
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  return (
    <Card>
      <CardHeader><CardTitle className="text-lg font-display">Weekly hours</CardTitle></CardHeader>
      <CardContent>
        {isLoading ? <Skeleton className="h-40" /> : (
          <div className="space-y-2">
            {DAYS.map((label, day) => {
              const row = rows.find((r) => r.day_of_week === day);
              return (
                <DayRow
                  key={day}
                  label={label}
                  row={row}
                  readOnly={readOnly}
                  onSave={(start, end, enabled) => upsert.mutate({ day, start, end, enabled })}
                />
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function DayRow({ label, row, readOnly, onSave }: { label: string; row?: ScheduleRow; readOnly: boolean; onSave: (s: string, e: string, enabled: boolean) => void }) {
  const [enabled, setEnabled] = useState(!!row);
  const [start, setStart] = useState(row?.start_time?.slice(0, 5) ?? "09:00");
  const [end, setEnd] = useState(row?.end_time?.slice(0, 5) ?? "18:00");

  function toggle(v: boolean) {
    setEnabled(v);
    if (!v) onSave("", "", false);
  }

  return (
    <div className="flex items-center gap-3 rounded-md border border-border p-2">
      <div className="w-14 text-sm font-medium">{label}</div>
      <Switch checked={enabled} onCheckedChange={toggle} disabled={readOnly} />
      {enabled && (
        <>
          <Input type="time" value={start} onChange={(e) => setStart(e.target.value)} className="w-32" disabled={readOnly} />
          <span className="text-xs text-muted-foreground">to</span>
          <Input type="time" value={end} onChange={(e) => setEnd(e.target.value)} className="w-32" disabled={readOnly} />
          {!readOnly && (
            <Button size="sm" variant="outline" onClick={() => onSave(start, end, true)}>Save</Button>
          )}
        </>
      )}
      {!enabled && <span className="text-xs text-muted-foreground">Day off</span>}
    </div>
  );
}

function LeaveSection({ userId, locationId, readOnly }: { userId: string; locationId: string; readOnly: boolean }) {
  const qc = useQueryClient();
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [reason, setReason] = useState("");

  const { data: leaves = [] } = useQuery({
    queryKey: ["leave", userId],
    queryFn: async () => {
      const { data, error } = await supabase.from("staff_leave").select("*").eq("user_id", userId).order("start_date", { ascending: false });
      if (error) throw error;
      return data as LeaveRow[];
    },
  });

  const add = useMutation({
    mutationFn: async () => {
      if (!start || !end) throw new Error("Pick both dates");
      if (start > end) throw new Error("End date must be after start date");
      const { error } = await supabase.from("staff_leave").insert({ user_id: userId, location_id: locationId, start_date: start, end_date: end, reason: reason.trim() || null });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["leave", userId] });
      setStart(""); setEnd(""); setReason("");
      toast.success("Leave added");
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("staff_leave").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["leave", userId] }),
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  return (
    <Card>
      <CardHeader><CardTitle className="text-lg font-display">Leave</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        {!readOnly && (
          <div className="flex flex-wrap items-end gap-2 rounded-md border border-dashed border-border p-3">
            <div className="space-y-1"><Label className="text-xs">From</Label><Input type="date" value={start} onChange={(e) => setStart(e.target.value)} /></div>
            <div className="space-y-1"><Label className="text-xs">To</Label><Input type="date" value={end} onChange={(e) => setEnd(e.target.value)} /></div>
            <div className="flex-1 space-y-1 min-w-40"><Label className="text-xs">Reason (optional)</Label><Input value={reason} onChange={(e) => setReason(e.target.value)} /></div>
            <Button onClick={() => add.mutate()} disabled={add.isPending}>Add leave</Button>
          </div>
        )}

        {leaves.length === 0 ? (
          <div className="text-sm text-muted-foreground">No leave scheduled.</div>
        ) : (
          <div className="space-y-1">
            {leaves.map((l) => (
              <div key={l.id} className="flex items-center justify-between rounded-md border border-border px-3 py-2 text-sm">
                <div>
                  <span className="font-medium">{format(parseISO(l.start_date), "MMM d, yyyy")} – {format(parseISO(l.end_date), "MMM d, yyyy")}</span>
                  {l.reason && <span className="ml-2 text-muted-foreground">· {l.reason}</span>}
                </div>
                {!readOnly && (
                  <Button variant="ghost" size="icon" onClick={() => remove.mutate(l.id)}>
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                )}
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
