import { X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { MultiSelect, type MultiSelectOption } from "@/components/ui/multi-select";
import {
  APPT_STATUSES,
  STATUS_LABELS,
  type AppointmentSearch,
  type ApptStatusValue,
  type RangePreset,
  formatDateParam,
  isCurrentPeriod,
  parseList,
  toList,
} from "@/lib/appointment-filters";

export type FilterPatch = Partial<AppointmentSearch>;

/**
 * The filter row. Deliberately one quiet line of controls rather than a panel
 * or a drawer: this screen is opened twenty times a day and anything that has
 * to be expanded before it can be used gets skipped (design.md · Motion, and
 * the high-frequency-screen rule).
 *
 * Every control writes straight to the URL via `onPatch` — there is no local
 * mirror of filter state to fall out of step with the address bar.
 */
export function AppointmentFilters({
  search,
  staffOptions,
  serviceOptions,
  onPatch,
  showStaff = true,
}: {
  search: AppointmentSearch;
  staffOptions: MultiSelectOption[];
  serviceOptions: MultiSelectOption[];
  onPatch: (patch: FilterPatch) => void;
  /** Hidden for a Staff account, whose view is already one person's diary. */
  showStaff?: boolean;
}) {
  const staff = parseList(search.staff);
  const service = parseList(search.service);
  const status = parseList(search.status);

  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-2 md:px-6">
      {showStaff && (
        <MultiSelect
          label="Staff"
          options={staffOptions}
          selected={staff}
          onChange={(next) => onPatch({ staff: toList(next) })}
          searchPlaceholder="Find a colleague…"
          emptyText="No bookable staff at this location."
          className="w-[9.5rem]"
        />
      )}
      <MultiSelect
        label="Service"
        options={serviceOptions}
        selected={service}
        onChange={(next) => onPatch({ service: toList(next) })}
        searchPlaceholder="Find a service…"
        emptyText="No active services."
        className="w-[9.5rem]"
      />
      <MultiSelect
        label="Status"
        options={APPT_STATUSES.map((s) => ({ value: s, label: STATUS_LABELS[s] }))}
        selected={status}
        onChange={(next) => onPatch({ status: toList(next) })}
        searchPlaceholder="Status…"
        className="w-[9.5rem]"
      />
      <div className="min-w-[12rem] flex-1">
        <Label htmlFor="appt-client-q" className="sr-only">
          Search client by name or phone
        </Label>
        <Input
          id="appt-client-q"
          dir="auto"
          value={search.q}
          onChange={(e) => onPatch({ q: e.target.value })}
          placeholder="Client name or phone"
          className="h-9"
        />
      </div>
    </div>
  );
}

/**
 * Active-filter summary. Renders nothing at all when no filter is applied, so
 * the unfiltered calendar keeps its full height.
 */
export function ActiveFilterChips({
  search,
  staffOptions,
  serviceOptions,
  resultCount,
  onPatch,
  onClearAll,
}: {
  search: AppointmentSearch;
  staffOptions: MultiSelectOption[];
  serviceOptions: MultiSelectOption[];
  resultCount: number;
  onPatch: (patch: FilterPatch) => void;
  onClearAll: () => void;
}) {
  const staff = parseList(search.staff);
  const service = parseList(search.service);
  const status = parseList(search.status);
  const q = search.q.trim();

  if (staff.length + service.length + status.length === 0 && !q) return null;

  const labelFor = (opts: MultiSelectOption[], v: string) =>
    opts.find((o) => o.value === v)?.label ?? v;

  return (
    <div className="flex flex-wrap items-center gap-1.5 border-b border-border bg-muted/30 px-4 py-2 md:px-6">
      <span className="mr-1 text-xs text-muted-foreground">Showing</span>
      <span className="tnum text-xs font-medium [overflow-wrap:normal]">{resultCount}</span>
      <span className="mr-2 text-xs text-muted-foreground">
        {resultCount === 1 ? "appointment" : "appointments"} matching
      </span>

      {staff.map((v) => (
        <Chip
          key={`staff-${v}`}
          label={`Staff: ${labelFor(staffOptions, v)}`}
          onRemove={() => onPatch({ staff: toList(staff.filter((x) => x !== v)) })}
        />
      ))}
      {service.map((v) => (
        <Chip
          key={`service-${v}`}
          label={`Service: ${labelFor(serviceOptions, v)}`}
          onRemove={() => onPatch({ service: toList(service.filter((x) => x !== v)) })}
        />
      ))}
      {status.map((v) => (
        <Chip
          key={`status-${v}`}
          label={STATUS_LABELS[v as ApptStatusValue] ?? v}
          onRemove={() => onPatch({ status: toList(status.filter((x) => x !== v)) })}
        />
      ))}
      {q && <Chip label={`Client: ${q}`} onRemove={() => onPatch({ q: "" })} />}

      <button
        type="button"
        onClick={onClearAll}
        className="ml-1 rounded px-1.5 py-0.5 text-xs text-muted-foreground underline underline-offset-2 transition-colors hover:text-foreground"
      >
        Clear all
      </button>
    </div>
  );
}

const PRESET_LABELS: Record<RangePreset, string> = {
  day: "Today",
  week: "This week",
  month: "This month",
  last_month: "Last month",
  custom: "Custom",
};

/** Appointments: a calendar has no use for a closed month. */
export const APPT_PRESETS: RangePreset[] = ["day", "week", "month", "custom"];
/** Reports: "last month" is the single most-asked-for reporting window. */
export const REPORT_PRESETS: RangePreset[] = ["day", "week", "month", "last_month", "custom"];

/**
 * Range presets plus a genuine from/to pair for Custom.
 *
 * Picking a preset re-anchors on the real today rather than keeping whatever
 * day the arrows had wandered to — "This month" reading as "the month of the
 * day I happened to be looking at" is the kind of quiet wrongness that makes
 * staff distrust a filter.
 */
export function DateRangeControl({
  search,
  onPatch,
  presets = APPT_PRESETS,
}: {
  search: AppointmentSearch;
  onPatch: (patch: FilterPatch) => void;
  presets?: RangePreset[];
}) {
  const today = formatDateParam(new Date());
  // A preset only reads as active while it still describes what's on screen.
  // Arrow off today and "Today" goes quiet rather than claiming otherwise.
  const onCurrent = isCurrentPeriod(search);

  // Changing the range never rewrites `view`. The two controls are orthogonal:
  // picking "This month" is a statement about which days to include, not about
  // how to draw them.
  function pick(preset: RangePreset) {
    if (preset === "custom") {
      const start = search.from || search.date || today;
      onPatch({ preset, from: start, to: search.to || start });
      return;
    }
    onPatch({ preset, date: today });
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {/* The group wraps; the buttons inside never do. Five presets do not fit
          on one 320px row, and without this the last one is clipped off the
          edge of the screen and cannot be tapped at all. */}
      <div
        role="group"
        aria-label="Date range"
        className="flex flex-wrap rounded-md border border-border p-0.5"
      >
        {presets.map((value) => {
          const p = { value, label: PRESET_LABELS[value] };
          const active = search.preset === p.value && onCurrent;
          return (
          <button
            key={p.value}
            type="button"
            onClick={() => pick(p.value)}
            aria-pressed={active}
            className={`whitespace-nowrap rounded px-2.5 py-1 text-xs font-medium transition-colors active:translate-y-px ${
              active
                ? "bg-accent text-accent-foreground"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {p.label}
          </button>
          );
        })}
      </div>

      {search.preset === "custom" && (
        <div className="flex items-center gap-1.5">
          <Label htmlFor="appt-from" className="sr-only">From date</Label>
          <Input
            id="appt-from"
            type="date"
            value={search.from}
            onChange={(e) => onPatch({ from: e.target.value })}
            className="h-9 w-[9.5rem]"
          />
          <span className="text-xs text-muted-foreground">to</span>
          <Label htmlFor="appt-to" className="sr-only">To date</Label>
          <Input
            id="appt-to"
            type="date"
            value={search.to}
            onChange={(e) => onPatch({ to: e.target.value })}
            className="h-9 w-[9.5rem]"
          />
        </div>
      )}
    </div>
  );
}

function Chip({ label, onRemove }: { label: string; onRemove: () => void }) {
  return (
    <span className="inline-flex max-w-[16rem] items-center gap-1 rounded-full border border-border bg-background py-0.5 pl-2 pr-1 text-xs">
      <span className="truncate" dir="auto">{label}</span>
      <button
        type="button"
        onClick={onRemove}
        aria-label={`Remove filter ${label}`}
        className="rounded-full p-0.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground active:translate-y-px"
      >
        <X aria-hidden className="h-3 w-3" />
      </button>
    </span>
  );
}
