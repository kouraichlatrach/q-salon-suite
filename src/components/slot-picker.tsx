import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { addDays, format, isSameDay, parseISO, startOfDay } from "date-fns";
import { Loader2 } from "lucide-react";

import { getBookingSlots, type PublicSlot } from "@/lib/booking.functions";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * Availability picker shared by the initial booking flow and the
 * client-facing reschedule flow, so both honour identical rules.
 */
export function SlotPicker({
  brandId,
  locationId,
  serviceId,
  staffUserId,
  maxAdvanceDays,
  onSelect,
  selectedIso,
  refreshKey = 0,
}: {
  brandId: string;
  locationId: string;
  serviceId: string;
  staffUserId: string | null;
  maxAdvanceDays: number;
  onSelect: (slot: PublicSlot) => void;
  selectedIso?: string | null;
  refreshKey?: number;
}) {
  const today = startOfDay(new Date());
  const horizon = Math.max(1, Math.min(maxAdvanceDays || 30, 120));
  const [dayOffset, setDayOffset] = useState(0);

  const dateFrom = format(today, "yyyy-MM-dd");
  const dateTo = format(addDays(today, horizon), "yyyy-MM-dd");

  const { data: slots = [], isLoading } = useQuery({
    queryKey: [
      "public-slots",
      brandId,
      locationId,
      serviceId,
      staffUserId,
      dateFrom,
      dateTo,
      refreshKey,
    ],
    queryFn: () =>
      getBookingSlots({
        data: { brandId, locationId, serviceId, staffUserId, dateFrom, dateTo },
      }),
    staleTime: 30_000,
  });

  /** Distinct days that actually contain availability, so empty days aren't offered. */
  const availableDays = useMemo(() => {
    const seen = new Map<string, Date>();
    for (const s of slots) {
      const d = startOfDay(parseISO(s.starts_at));
      const key = format(d, "yyyy-MM-dd");
      if (!seen.has(key)) seen.set(key, d);
    }
    return [...seen.values()].sort((a, b) => a.getTime() - b.getTime());
  }, [slots]);

  const activeDay = availableDays[Math.min(dayOffset, availableDays.length - 1)] ?? null;

  /** One button per start time; when "no preference" is active we keep the first staff per time. */
  const daySlots = useMemo(() => {
    if (!activeDay) return [] as PublicSlot[];
    const byTime = new Map<string, PublicSlot>();
    for (const s of slots) {
      const at = parseISO(s.starts_at);
      if (!isSameDay(at, activeDay)) continue;
      const key = s.starts_at;
      if (!byTime.has(key)) byTime.set(key, s);
    }
    return [...byTime.values()].sort(
      (a, b) => parseISO(a.starts_at).getTime() - parseISO(b.starts_at).getTime(),
    );
  }, [slots, activeDay]);

  if (isLoading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }

  if (availableDays.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-border bg-card/50 p-8 text-center">
        <p className="font-display text-lg">No times available</p>
        <p className="mt-1.5 text-sm text-muted-foreground">
          There's no open availability for this selection right now. Try a different stylist or
          service, or check back soon.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
        {availableDays.map((d, i) => {
          const active = activeDay ? isSameDay(d, activeDay) : false;
          return (
            <button
              key={d.toISOString()}
              type="button"
              onClick={() => setDayOffset(i)}
              className={`min-w-[4.5rem] shrink-0 rounded-xl border px-3 py-2.5 text-center transition-colors ${
                active
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border bg-card hover:border-primary/50"
              }`}
            >
              <span className="block text-[11px] uppercase tracking-wider opacity-80">
                {format(d, "EEE")}
              </span>
              <span className="block font-display text-lg font-semibold leading-tight">
                {format(d, "d")}
              </span>
              <span className="block text-[11px] opacity-80">{format(d, "MMM")}</span>
            </button>
          );
        })}
      </div>

      <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
        {daySlots.map((s) => {
          const active = selectedIso === s.starts_at;
          return (
            <Button
              key={s.starts_at}
              type="button"
              variant={active ? "default" : "outline"}
              className="h-11 font-medium tabular-nums"
              onClick={() => onSelect(s)}
            >
              {format(parseISO(s.starts_at), "HH:mm")}
            </Button>
          );
        })}
      </div>
    </div>
  );
}

export function SlotPickerPending() {
  return (
    <div className="flex items-center gap-2 text-sm text-muted-foreground">
      <Loader2 className="h-4 w-4 animate-spin" /> Checking availability…
    </div>
  );
}
