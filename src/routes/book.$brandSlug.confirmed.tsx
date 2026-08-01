import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { zodValidator, fallback } from "@tanstack/zod-adapter";
import { z } from "zod";
import { format, parseISO } from "date-fns";
import { CalendarDays, Check, Clock, MapPin, User, Wallet } from "lucide-react";
import { toast } from "sonner";

import { getAppointmentByToken, type PublicAppointment } from "@/lib/booking.functions";
import { BookingShell, StepHeading } from "@/components/booking-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatMoney } from "@/lib/money";

/**
 * Post-payment confirmation.
 *
 * Previously the client was returned straight to the manage page after paying,
 * with no acknowledgement that the payment succeeded — the most likely trigger
 * for a "did my payment go through?" call to the salon.
 *
 * Payment state here is read from the database, never from the URL. Per the
 * Section 9 architecture rule, a redirect back from checkout is cosmetic: it
 * proves nothing. If the webhook hasn't landed yet the page says "confirming
 * your payment", which is the honest state, and the client can re-check.
 */

const searchSchema = z.object({
  token: fallback(z.coerce.string(), "").default(""),
});

export const Route = createFileRoute("/book/$brandSlug/confirmed")({
  validateSearch: zodValidator(searchSchema),
  loaderDeps: ({ search }) => ({ token: search.token }),
  loader: async ({ deps }) => {
    if (!deps.token) return { appointment: null };
    const appointment = await getAppointmentByToken({ data: { token: deps.token } });
    return { appointment };
  },
  head: () => ({
    meta: [{ title: "Booking confirmed" }, { name: "robots", content: "noindex" }],
  }),
  component: ConfirmedPage,
});

function ConfirmedPage() {
  const { appointment } = Route.useLoaderData();
  const search = Route.useSearch();
  const router = useRouter();
  const [checking, setChecking] = useState(false);

  if (!appointment) {
    return (
      <BookingShell>
        <div className="py-16 text-center">
          <h1 className="font-display text-2xl font-semibold">We couldn't find that booking</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            The link may be incorrect or expired.
          </p>
        </div>
      </BookingShell>
    );
  }

  const appt = appointment as PublicAppointment;
  const manageUrl = `${typeof window !== "undefined" ? window.location.origin : ""}/manage/${search.token}`;
  const paid = appt.deposit_status === "paid";
  const awaitingPayment = appt.deposit_status === "pending";

  async function recheck() {
    setChecking(true);
    try {
      await router.invalidate();
    } finally {
      setChecking(false);
    }
  }

  return (
    <BookingShell brandName={appt.brand_name}>
      {awaitingPayment ? (
        <>
          <StepHeading
            title="Confirming your payment…"
            subtitle="This usually takes a few seconds."
          />
          <div className="rounded-xl border border-dashed border-border bg-card p-5 text-sm text-muted-foreground">
            <p>
              We're waiting for your bank to confirm the deposit. Your slot is held in
              the meantime — you don't need to book again.
            </p>
            <Button
              variant="outline"
              className="mt-4"
              disabled={checking}
              onClick={() => void recheck()}
            >
              {checking ? "Checking…" : "Check again"}
            </Button>
          </div>
        </>
      ) : (
        <div className="mb-6 flex flex-col items-center text-center">
          <span className="mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-primary/10">
            <Check className="h-7 w-7 text-primary" />
          </span>
          <h1 className="font-display text-3xl font-semibold tracking-tight">You're booked</h1>
          {paid && (
            <p className="mt-2 text-sm text-muted-foreground">
              Deposit received — thank you. A confirmation is below.
            </p>
          )}
        </div>
      )}

      <div className="mt-6 rounded-xl border border-border bg-card p-5">
        <p className="font-display text-xl font-semibold" dir="auto">
          {appt.service_name ?? "Appointment"}
        </p>
        <p className="mt-3 flex items-center gap-1.5 text-sm text-muted-foreground">
          <CalendarDays className="h-4 w-4" />
          {format(parseISO(appt.starts_at), "EEEE d MMMM yyyy · HH:mm")}
        </p>
        {appt.duration_minutes && (
          <p className="mt-1.5 flex items-center gap-1.5 text-sm text-muted-foreground">
            <Clock className="h-4 w-4" />
            {appt.duration_minutes} min
          </p>
        )}
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
      </div>

      {paid && <PaymentBreakdown appt={appt} />}

      <div className="mt-5 rounded-xl border border-dashed border-border bg-accent/20 p-5">
        <p className="text-sm font-medium">Save this link</p>
        <p className="mt-1 text-sm text-muted-foreground">
          It's the only way to reschedule or cancel — we can't text it to you yet.
        </p>
        <div className="mt-3 flex flex-col gap-2 sm:flex-row">
          <Input readOnly value={manageUrl} className="text-xs" />
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              void navigator.clipboard.writeText(manageUrl);
              toast.success("Link copied");
            }}
          >
            Copy
          </Button>
        </div>
        <Link
          to="/manage/$token"
          params={{ token: search.token }}
          className="mt-3 inline-block text-sm underline underline-offset-4"
        >
          Manage this booking →
        </Link>
      </div>
    </BookingShell>
  );
}

/** Paid vs. remaining, so the client knows exactly what's still owed. */
export function PaymentBreakdown({ appt }: { appt: PublicAppointment }) {
  const ccy = appt.currency ?? "QAR";
  const paidAmount = Number(appt.deposit_paid_amount ?? 0);
  const balance = Number(appt.balance_due ?? appt.price ?? 0);

  return (
    <div className="mt-5 rounded-xl border border-border bg-card p-5">
      <p className="mb-3 flex items-center gap-1.5 text-sm font-medium">
        <Wallet className="h-4 w-4 text-primary" />
        Payment
      </p>
      <dl className="space-y-2.5 text-sm">
        <div className="flex items-baseline justify-between gap-4">
          <dt className="text-muted-foreground">Total</dt>
          <dd className="text-right font-medium">{formatMoney(appt.price, ccy)}</dd>
        </div>
        <div className="flex items-baseline justify-between gap-4">
          <dt className="text-muted-foreground">Deposit paid</dt>
          <dd className="text-right font-medium text-primary">
            −{formatMoney(paidAmount, ccy)}
          </dd>
        </div>
        <div className="flex items-baseline justify-between gap-4 border-t border-border pt-2.5">
          <dt className="font-medium">Due at the salon</dt>
          <dd className="text-right font-display text-lg font-semibold">
            {formatMoney(balance, ccy)}
          </dd>
        </div>
      </dl>
    </div>
  );
}
