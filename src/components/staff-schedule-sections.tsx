/**
 * Weekly hours + leave, extracted from the standalone /app/staff/$id/schedule
 * route so the staff profile page can carry them without a second copy.
 *
 * Moved verbatim rather than rewritten: this is working, tested code that the
 * booking availability calculation depends on (staff_schedules and staff_leave
 * both feed public_compute_slots). A "tidy up while I'm here" pass would put
 * that at risk for no benefit.
 */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { format, parseISO } from "date-fns";
import { Trash2 } from "lucide-react";
import { toast } from "sonner";

import { errorMessage } from "@/lib/error-message";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export type ScheduleRow = {
  id: string;
  user_id: string;
  location_id: string;
  day_of_week: number;
  start_time: string;
  end_time: string;
};
export type LeaveRow = {
  id: string;
  user_id: string;
  location_id: string | null;
  start_date: string;
  end_date: string;
  reason: string | null;
};

export function WeeklyHours({
  userId,
  locationId,
  readOnly,
}: {
  userId: string;
  locationId: string;
  readOnly: boolean;
}) {
  const qc = useQueryClient();
  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["sched", userId, locationId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("staff_schedules")
        .select("*")
        .eq("user_id", userId)
        .eq("location_id", locationId)
        .order("day_of_week");
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
        const { error } = await supabase
          .from("staff_schedules")
          .update({ start_time: input.start, end_time: input.end })
          .eq("id", existing.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("staff_schedules").insert({
          user_id: userId,
          location_id: locationId,
          day_of_week: input.day,
          start_time: input.start,
          end_time: input.end,
        });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["sched", userId, locationId] });
      toast.success("Schedule saved");
    },
    onError: (e) => toast.error(errorMessage(e, "Failed")),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="font-display text-lg">Weekly hours</CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <Skeleton className="h-40" />
        ) : (
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

function DayRow({
  label,
  row,
  readOnly,
  onSave,
}: {
  label: string;
  row?: ScheduleRow;
  readOnly: boolean;
  onSave: (s: string, e: string, enabled: boolean) => void;
}) {
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
          <Input
            type="time"
            value={start}
            onChange={(e) => setStart(e.target.value)}
            className="w-32 tnum [overflow-wrap:normal]"
            disabled={readOnly}
          />
          <span className="text-xs text-muted-foreground">to</span>
          <Input
            type="time"
            value={end}
            onChange={(e) => setEnd(e.target.value)}
            className="w-32 tnum [overflow-wrap:normal]"
            disabled={readOnly}
          />
          {!readOnly && (
            <Button size="sm" variant="outline" onClick={() => onSave(start, end, true)}>
              Save
            </Button>
          )}
        </>
      )}
      {!enabled && <span className="text-xs text-muted-foreground">Day off</span>}
    </div>
  );
}

export function LeaveSection({
  userId,
  locationId,
  readOnly,
}: {
  userId: string;
  locationId: string;
  readOnly: boolean;
}) {
  const qc = useQueryClient();
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [reason, setReason] = useState("");

  const { data: leaves = [] } = useQuery({
    queryKey: ["leave", userId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("staff_leave")
        .select("*")
        .eq("user_id", userId)
        .order("start_date", { ascending: false });
      if (error) throw error;
      return data as LeaveRow[];
    },
  });

  const add = useMutation({
    mutationFn: async () => {
      if (!start || !end) throw new Error("Pick both dates");
      if (start > end) throw new Error("End date must be after start date");
      const { error } = await supabase.from("staff_leave").insert({
        user_id: userId,
        location_id: locationId,
        start_date: start,
        end_date: end,
        reason: reason.trim() || null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["leave", userId] });
      setStart("");
      setEnd("");
      setReason("");
      toast.success("Leave added");
    },
    onError: (e) => toast.error(errorMessage(e, "Failed")),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("staff_leave").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["leave", userId] }),
    onError: (e) => toast.error(errorMessage(e, "Failed")),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="font-display text-lg">Leave</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {!readOnly && (
          <div className="flex flex-wrap items-end gap-2 rounded-md border border-dashed border-border p-3">
            <div className="space-y-1">
              <Label className="text-xs">From</Label>
              <Input type="date" value={start} onChange={(e) => setStart(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">To</Label>
              <Input type="date" value={end} onChange={(e) => setEnd(e.target.value)} />
            </div>
            <div className="min-w-40 flex-1 space-y-1">
              <Label className="text-xs">Reason (optional)</Label>
              <Input value={reason} onChange={(e) => setReason(e.target.value)} dir="auto" />
            </div>
            <Button variant="outline" onClick={() => add.mutate()} disabled={add.isPending}>
              Add leave
            </Button>
          </div>
        )}

        {leaves.length === 0 ? (
          <div className="text-sm text-muted-foreground">No leave recorded.</div>
        ) : (
          <div className="space-y-1">
            {leaves.map((l) => (
              <div
                key={l.id}
                className="flex items-center justify-between rounded-md border border-border px-3 py-2 text-sm"
              >
                <div>
                  <span className="font-medium tnum [overflow-wrap:normal]">
                    {format(parseISO(l.start_date), "MMM d, yyyy")} –{" "}
                    {format(parseISO(l.end_date), "MMM d, yyyy")}
                  </span>
                  {l.reason && (
                    <span className="ml-2 text-muted-foreground" dir="auto">
                      · {l.reason}
                    </span>
                  )}
                </div>
                {!readOnly && (
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => remove.mutate(l.id)}
                    aria-label="Remove leave"
                  >
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
