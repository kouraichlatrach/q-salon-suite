import { createFileRoute, notFound } from "@tanstack/react-router";
import { useState } from "react";
import { format, parseISO } from "date-fns";
import { CalendarDays, MapPin, User } from "lucide-react";
import { toast } from "sonner";

import {
  cancelByToken,
  getAppointmentByToken,
  rescheduleByToken,
  type PublicAppointment,
} from "@/lib/booking.functions";
import { BookingShell, StepHeading } from "@/components/booking-shell";
import { SlotPicker } from "@/components/slot-picker";
import { Button } from "@/components/ui/button";
import { errorMessage } from "@/lib/error-message";

export const Route = createFileRoute("/manage/$token")({
  loader: async ({ params }) => {
    const appointment = await getAppointmentByToken({ data: { token: params.token } });
    if (!appointment) throw notFound();
    return { appointment };
  },
  head: () => ({
    meta: [
      { title: "Manage your booking" },
      { name: "description", content: "Reschedule or cancel your salon appointment." },
      { property: "og:title", content: "Manage your booking" },
      { property: "og:description", content: "Reschedule or cancel your salon appointment." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
    ],
  }),
  notFoundComponent: () => (
    <BookingShell>
      <div className="py-16 text-center">
        <h1 className="font-display text-2xl font-semibold">Link no longer valid</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          This booking link has expired, or the appointment has already passed or been cancelled.
        </p>
      </div>
    </BookingShell>
  ),
  errorComponent: () => (
    <BookingShell>
      <div className="py-16 text-center">
        <h1 className="font-display text-2xl font-semibold">Something went wrong</h1>
      </div>
    </BookingShell>
  ),
  component: ManagePage,
});

function ManagePage() {
  const { token } = Route.useParams();
  const loaderData = Route.useLoaderData();
  const initial = loaderData.appointment as PublicAppointment;

  const [appt, setAppt] = useState(initial);
  const [mode, setMode] = useState<"view" | "reschedule">("view");
  const [busy, setBusy] = useState(false);
  const [refresh, setRefresh] = useState(0);

  const cancelled = appt.status === "cancelled";

  async function doCancel() {
    setBusy(true);
    try {
      const res = await cancelByToken({ data: { token } });
      if (!res.ok) {
        toast.error("This booking can no longer be cancelled online.");
        return;
      }
      setAppt({ ...appt, status: "cancelled" });
      toast.success("Your booking has been cancelled");
    } catch (err) {
      toast.error("Cancellation failed", {
        description: errorMessage(err, "Please try again."),
      });
    } finally {
      setBusy(false);
    }
  }

  async function doReschedule(startsAt: string) {
    setBusy(true);
    try {
      const { result } = await rescheduleByToken({ data: { token, startsAt } });
      if (result === "slot_taken") {
        setRefresh((n) => n + 1);
        toast.error("That time was just taken", { description: "Please pick another slot." });
        return;
      }
      if (result !== "ok") {
        toast.error("This booking can no longer be changed online.");
        return;
      }
      const fresh = await getAppointmentByToken({ data: { token } });
      if (fresh) setAppt(fresh as PublicAppointment);
      setMode("view");
      toast.success("Your appointment has been moved");
    } catch (err) {
      toast.error("Reschedule failed", { description: errorMessage(err, "Please try again.") });
    } finally {
      setBusy(false);
    }
  }

  return (
    <BookingShell brandName={appt.brand_name}>
      {mode === "reschedule" && appt.service_id ? (
        <>
          <StepHeading
            title="Pick a new time"
            subtitle={appt.service_name ?? undefined}
            onBack={() => setMode("view")}
          />
          <SlotPicker
            brandId={appt.brand_id}
            locationId={appt.location_id}
            serviceId={appt.service_id}
            staffUserId={appt.staff_user_id}
            maxAdvanceDays={30}
            refreshKey={refresh}
            onSelect={(s) => {
              if (!busy) void doReschedule(s.starts_at);
            }}
          />
        </>
      ) : (
        <>
          <StepHeading
            title={cancelled ? "Booking cancelled" : "Your booking"}
            subtitle={cancelled ? undefined : "Reschedule or cancel below."}
          />

          <div className="rounded-xl border border-border bg-card p-5">
            <p className="font-display text-xl font-semibold" dir="auto">
              {appt.service_name ?? "Appointment"}
            </p>
            <p className="mt-3 flex items-center gap-1.5 text-sm text-muted-foreground">
              <CalendarDays className="h-4 w-4" />
              {format(parseISO(appt.starts_at), "EEEE d MMMM yyyy · HH:mm")}
            </p>
            <p className="mt-1.5 flex items-center gap-1.5 text-sm text-muted-foreground">
              <MapPin className="h-4 w-4" />
              <span dir="auto">
                {appt.location_name}
                {appt.location_address ? ` — ${appt.location_address}` : ""}
              </span>
            </p>
            <p className="mt-1.5 flex items-center gap-1.5 text-sm text-muted-foreground">
              <User className="h-4 w-4" />
              <span dir="auto">{appt.staff_name}</span>
            </p>
            {appt.price != null && (
              <p className="mt-4 font-display text-lg font-semibold text-primary">
                {new Intl.NumberFormat("en-QA", { maximumFractionDigits: 0 }).format(
                  Number(appt.price),
                )}{" "}
                {appt.currency}
              </p>
            )}
          </div>

          {cancelled ? (
            <p className="mt-6 rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">
              This appointment has been cancelled. Contact the salon if you'd like to rebook.
            </p>
          ) : (
            <div className="mt-6 flex flex-col gap-3 sm:flex-row">
              <Button
                className="h-12 flex-1 text-base"
                disabled={busy || !appt.service_id}
                onClick={() => setMode("reschedule")}
              >
                Reschedule
              </Button>
              <Button
                variant="outline"
                className="h-12 flex-1 text-base"
                disabled={busy}
                onClick={doCancel}
              >
                Cancel booking
              </Button>
            </div>
          )}
        </>
      )}
    </BookingShell>
  );
}
