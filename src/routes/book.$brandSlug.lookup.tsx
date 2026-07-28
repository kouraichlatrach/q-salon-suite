import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { useState } from "react";
import { format, parseISO } from "date-fns";
import { CalendarDays, MapPin, User } from "lucide-react";
import { toast } from "sonner";

import {
  getBookingContext,
  lookupBookingsByPhone,
  requestBookingOtp,
  type PublicBrand,
} from "@/lib/booking.functions";
import { BookingShell, StepHeading } from "@/components/booking-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { errorMessage } from "@/lib/error-message";

export const Route = createFileRoute("/book/$brandSlug/lookup")({
  loader: async ({ params }) => {
    const ctx = await getBookingContext({ data: { slug: params.brandSlug } });
    if (!ctx.brand) throw notFound();
    return ctx;
  },
  head: ({ loaderData }) => {
    if (!loaderData?.brand) {
      return { meta: [{ title: "Unavailable" }, { name: "robots", content: "noindex" }] };
    }
    const title = `Find my booking — ${loaderData.brand.name}`;
    const description = `Look up your upcoming appointments at ${loaderData.brand.name} using your mobile number.`;
    return {
      meta: [
        { title },
        { name: "description", content: description },
        { property: "og:title", content: title },
        { property: "og:description", content: description },
        { property: "og:type", content: "website" },
        { name: "twitter:card", content: "summary" },
        { name: "robots", content: "noindex" },
      ],
    };
  },
  notFoundComponent: () => (
    <BookingShell>
      <div className="py-16 text-center">
        <h1 className="font-display text-2xl font-semibold">Salon not found</h1>
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
  component: LookupPage,
});

type Booking = {
  appointment_id: string;
  token: string | null;
  starts_at: string;
  service_name: string | null;
  location_name: string;
  staff_name: string;
};

function LookupPage() {
  const loaderData = Route.useLoaderData();
  const brand = loaderData.brand as PublicBrand;
  const { brandSlug } = Route.useParams();

  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [sent, setSent] = useState(false);
  const [devCode, setDevCode] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<Booking[] | null>(null);

  async function sendCode() {
    setBusy(true);
    try {
      const res = await requestBookingOtp({ data: { brandId: brand.id, phone } });
      if (!res.ok) {
        toast.error(
          res.error === "invalid_phone"
            ? "That doesn't look like a valid phone number."
            : res.error === "rate_limited"
              ? "Too many codes requested. Please wait a few minutes."
              : "Could not send the code.",
        );
        return;
      }
      setSent(true);
      setDevCode(res.devCode);
      toast.success(res.smsConfigured ? "Code sent by SMS" : "Verification code generated");
    } catch (err) {
      toast.error("Could not send the code", {
        description: errorMessage(err, "Please try again."),
      });
    } finally {
      setBusy(false);
    }
  }

  async function verify() {
    setBusy(true);
    try {
      const res = await lookupBookingsByPhone({
        data: { brandId: brand.id, phone, code: code.trim() },
      });
      if (!res.ok) {
        toast.error(
          res.error === "bad_code"
            ? "That code isn't right or has expired."
            : "That phone number isn't valid.",
        );
        return;
      }
      setResults(res.appointments as Booking[]);
    } catch (err) {
      toast.error("Lookup failed", { description: errorMessage(err, "Please try again.") });
    } finally {
      setBusy(false);
    }
  }

  return (
    <BookingShell
      brandName={brand.name}
      footerSlot={
        <p className="text-xs text-muted-foreground">
          Need a new appointment?{" "}
          <Link
            to="/book/$brandSlug"
            params={{ brandSlug }}
            className="underline underline-offset-4 hover:text-foreground"
          >
            Book now
          </Link>
        </p>
      }
    >
      {results === null ? (
        <>
          <StepHeading
            title="Find my booking"
            subtitle="Verify your mobile number to see your upcoming appointments."
          />
          <div className="space-y-4">
            <div>
              <Label htmlFor="lk-phone">Mobile number</Label>
              <Input
                id="lk-phone"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="+974 5555 1234"
                inputMode="tel"
                autoComplete="tel"
                disabled={sent}
              />
            </div>

            {sent && (
              <div>
                <Label htmlFor="lk-code">Verification code</Label>
                <Input
                  id="lk-code"
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                  placeholder="000000"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  className="text-center text-lg tracking-[0.4em]"
                />
                {devCode && (
                  <p className="mt-2 rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-900">
                    SMS isn't configured yet — your test code is{" "}
                    <span className="font-semibold tabular-nums">{devCode}</span>
                  </p>
                )}
              </div>
            )}

            <Button
              className="h-12 w-full text-base"
              disabled={busy || (!sent && phone.trim().length < 6) || (sent && code.length < 4)}
              onClick={sent ? verify : sendCode}
            >
              {busy ? "Please wait…" : sent ? "Show my bookings" : "Send verification code"}
            </Button>
          </div>
        </>
      ) : (
        <>
          <StepHeading
            title="Your upcoming bookings"
            subtitle={results.length === 0 ? undefined : `${results.length} scheduled`}
          />
          {results.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border p-8 text-center">
              <p className="font-display text-lg">Nothing scheduled</p>
              <p className="mt-1.5 text-sm text-muted-foreground">
                We couldn't find any upcoming appointments for that number.
              </p>
              <Button asChild className="mt-5">
                <Link to="/book/$brandSlug" params={{ brandSlug }}>
                  Book an appointment
                </Link>
              </Button>
            </div>
          ) : (
            <div className="space-y-3">
              {results.map((b) => {
                const card = (
                  <div className="rounded-xl border border-border bg-card p-4 transition-colors hover:border-primary/60">
                    <p className="font-display text-lg font-semibold" dir="auto">
                      {b.service_name ?? "Appointment"}
                    </p>
                    <p className="mt-2 flex items-center gap-1.5 text-sm text-muted-foreground">
                      <CalendarDays className="h-4 w-4" />
                      {format(parseISO(b.starts_at), "EEEE d MMMM · HH:mm")}
                    </p>
                    <p className="mt-1 flex items-center gap-1.5 text-sm text-muted-foreground">
                      <MapPin className="h-4 w-4" />
                      <span dir="auto">{b.location_name}</span>
                    </p>
                    <p className="mt-1 flex items-center gap-1.5 text-sm text-muted-foreground">
                      <User className="h-4 w-4" />
                      <span dir="auto">{b.staff_name}</span>
                    </p>
                    {b.token && (
                      <p className="mt-3 text-sm font-medium text-primary">
                        Manage this booking →
                      </p>
                    )}
                  </div>
                );
                return b.token ? (
                  <Link
                    key={b.appointment_id}
                    to="/manage/$token"
                    params={{ token: b.token }}
                    className="block"
                  >
                    {card}
                  </Link>
                ) : (
                  <div key={b.appointment_id}>{card}</div>
                );
              })}
            </div>
          )}
        </>
      )}
    </BookingShell>
  );
}
