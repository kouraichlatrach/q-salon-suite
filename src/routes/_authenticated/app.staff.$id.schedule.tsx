/**
 * Standalone schedule route — /app/staff/$id/schedule
 *
 * The weekly-hours and leave editors now live on the staff profile page too.
 * Rather than duplicate them, both surfaces import the same components from
 * @/components/staff-schedule-sections. This route is kept because it is a live
 * URL that may be bookmarked, and because a Staff member can reach their own
 * schedule here without the profile page's wider permission surface.
 */
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft } from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/hooks/use-tenant";
import { AppShell } from "@/components/app-shell";
import { WeeklyHours, LeaveSection } from "@/components/staff-schedule-sections";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
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

type LocationRow = { id: string; name: string };

function SchedulePage() {
  const tenant = useTenant();
  const { id: staffUserId } = Route.useParams();
  const navigate = useNavigate();

  if (tenant.isLoading)
    return (
      <AppShell>
        <div className="p-8">
          <Skeleton className="h-96" />
        </div>
      </AppShell>
    );
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
        <Button
          variant="ghost"
          size="sm"
          onClick={() => navigate({ to: "/app/staff" })}
          className="mb-4 whitespace-nowrap"
        >
          <ArrowLeft className="mr-1 h-4 w-4" aria-hidden="true" /> Back to staff
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
      const { data } = await supabase
        .from("profiles")
        .select("full_name, email")
        .eq("id", staffUserId)
        .maybeSingle();
      return data;
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

  const { data: role } = useQuery({
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

  const [locationId, setLocationId] = useState<string | null>(null);
  const effectiveLocId = locationId ?? role?.location_id ?? locations[0]?.id ?? null;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-2xl font-semibold [overflow-wrap:anywhere]" dir="auto">
          {person?.full_name || person?.email || "Staff schedule"}
        </h1>
        <p className="text-sm text-muted-foreground">Weekly working hours and leave.</p>
      </div>

      {locations.length > 1 && (
        <div className="flex items-center gap-2">
          <Label>Location</Label>
          <Select value={effectiveLocId ?? ""} onValueChange={setLocationId}>
            <SelectTrigger className="w-56">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {locations.map((l) => (
                <SelectItem key={l.id} value={l.id}>
                  {l.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      {effectiveLocId && (
        <WeeklyHours userId={staffUserId} locationId={effectiveLocId} readOnly={readOnly} />
      )}
      {effectiveLocId && (
        <LeaveSection userId={staffUserId} locationId={effectiveLocId} readOnly={readOnly} />
      )}
    </div>
  );
}
