import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { zodValidator, fallback } from "@tanstack/zod-adapter";
import { z } from "zod";
import { format, parseISO } from "date-fns";
import { Check, Clock, MapPin, Sparkles, User } from "lucide-react";
import { toast } from "sonner";

import {
  confirmBooking,
  getBookingContext,
  getBookingServices,
  getBookingStaff,
  requestBookingOtp,
  type PublicSlot,
  type PublicBrand,
  type PublicLocation,
} from "@/lib/booking.functions";
import { BookingShell, StepHeading, Stepper } from "@/components/booking-shell";
import { SlotPicker } from "@/components/slot-picker";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { errorMessage } from "@/lib/error-message";

const searchSchema = z.object({
  location: fallback(z.string(), "").default(""),
});

export const Route = createFileRoute("/book/$brandSlug")({
  validateSearch: zodValidator(searchSchema),
  loader: async ({ params }) => {
    const ctx = await getBookingContext({ data: { slug: params.brandSlug } });
    if (!ctx.brand) throw notFound();
    return ctx;
  },
  head: ({ loaderData }) => {
    if (!loaderData?.brand) {
      return {
        meta: [{ title: "Booking unavailable" }, { name: "robots", content: "noindex" }],
      };
    }
    const title = `Book an appointment — ${loaderData.brand.name}`;
    const description = `Reserve your next appointment at ${loaderData.brand.name}. Choose your service, stylist and time in under a minute.`;
    return {
      meta: [
        { title },
        { name: "description", content: description },
        { property: "og:title", content: title },
        { property: "og:description", content: description },
        { property: "og:type", content: "website" },
        { name: "twitter:card", content: "summary_large_image" },
      ],
    };
  },
  errorComponent: () => (
    <BookingShell>
      <div className="py-16 text-center">
        <h1 className="font-display text-2xl font-semibold">Something went wrong</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          We couldn't load this salon's booking page. Please try again.
        </p>
      </div>
    </BookingShell>
  ),
  notFoundComponent: () => (
    <BookingShell>
      <div className="py-16 text-center">
        <h1 className="font-display text-2xl font-semibold">Salon not found</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          This booking link doesn't match any salon. Please double-check the address.
        </p>
      </div>
    </BookingShell>
  ),
  component: BookingPage,
});

type Step = "location" | "service" | "staff" | "time" | "verify" | "done";

function BookingPage() {
  const loaderData = Route.useLoaderData();
  const brand = loaderData.brand as PublicBrand;
  const locations = loaderData.locations as PublicLocation[];
  const search = Route.useSearch();
  const { brandSlug } = Route.useParams();

  const deepLinked = useMemo(
    () => locations.find((l) => l.id === search.location) ?? null,
    [locations, search.location],
  );
  const onlyLocation = locations.length === 1 ? locations[0] : null;
  const initialLocation = deepLinked ?? onlyLocation;

  const [locationId, setLocationId] = useState<string | null>(initialLocation?.id ?? null);
  const [serviceId, setServiceId] = useState<string | null>(null);
  const [staffUserId, setStaffUserId] = useState<string | null>(null);
  const [noPreference, setNoPreference] = useState(false);
  const [slot, setSlot] = useState<PublicSlot | null>(null);
  const [step, setStep] = useState<Step>(initialLocation ? "service" : "location");
  const [result, setResult] = useState<{ manageUrl: string; smsSent: boolean } | null>(null);
  const [slotRefresh, setSlotRefresh] = useState(0);

  const location = locations.find((l) => l.id === locationId) ?? null;

  const { data: services = [], isLoading: servicesLoading } = useQuery({
    queryKey: ["public-services", brand!.id, locationId],
    queryFn: () =>
      getBookingServices({ data: { brandId: brand!.id, locationId: locationId! } }),
    enabled: Boolean(locationId),
  });

  const service = services.find((s) => s.id === serviceId) ?? null;

  const { data: staffOptions = [], isLoading: staffLoading } = useQuery({
    queryKey: ["public-staff", brand!.id, locationId, serviceId],
    queryFn: () =>
      getBookingStaff({
        data: { brandId: brand!.id, locationId: locationId!, serviceId: serviceId! },
      }),
    enabled: Boolean(locationId && serviceId),
  });

  const canSkipLocation = Boolean(onlyLocation || deepLinked);
  const totalSteps = canSkipLocation ? 4 : 5;
  const stepIndex: Record<Step, number> = canSkipLocation
    ? { location: 1, service: 1, staff: 2, time: 3, verify: 4, done: 4 }
    : { location: 1, service: 2, staff: 3, time: 4, verify: 5, done: 5 };

  const money = (v: number, ccy: string) =>
    `${new Intl.NumberFormat("en-QA", { maximumFractionDigits: 0 }).format(v)} ${ccy}`;

  return (
    <BookingShell
      brandName={brand!.name}
      footerSlot={
        step !== "done" ? (
          <p className="text-xs text-muted-foreground">
            Already booked?{" "}
            <Link
              to="/book/$brandSlug/lookup"
              params={{ brandSlug }}
              className="underline underline-offset-4 hover:text-foreground"
            >
              Look up my booking
            </Link>
          </p>
        ) : null
      }
    >
      {step !== "done" && <Stepper step={stepIndex[step]} total={totalSteps} />}

      {/* ---------------- Step 1: location ---------------- */}
      {step === "location" && (
        <>
          <StepHeading
            title="Choose a location"
            subtitle="Where would you like to be seen?"
          />
          <div className="space-y-3">
            {locations.map((l) => (
              <button
                key={l.id}
                type="button"
                onClick={() => {
                  setLocationId(l.id);
                  setStep("service");
                }}
                className="flex w-full items-start gap-3 rounded-xl border border-border bg-card p-4 text-left transition-colors hover:border-primary/60 hover:bg-accent/30"
              >
                <MapPin className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
                <span className="min-w-0">
                  <span className="block font-medium" dir="auto">
                    {l.name}
                  </span>
                  {l.address && (
                    <span className="mt-0.5 block text-sm text-muted-foreground" dir="auto">
                      {l.address}
                    </span>
                  )}
                </span>
              </button>
            ))}
            {locations.length === 0 && (
              <p className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">
                This salon hasn't published any locations for online booking yet.
              </p>
            )}
          </div>
        </>
      )}

      {/* ---------------- Step 2: service ---------------- */}
      {step === "service" && (
        <>
          <StepHeading
            title="Select a service"
            subtitle={location?.name ?? undefined}
            onBack={canSkipLocation ? undefined : () => setStep("location")}
          />
          {servicesLoading ? (
            <div className="space-y-3">
              <Skeleton className="h-20 w-full" />
              <Skeleton className="h-20 w-full" />
            </div>
          ) : services.length === 0 ? (
            <p className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">
              No services are available for online booking at this location yet.
            </p>
          ) : (
            <div className="space-y-3">
              {services.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => {
                    setServiceId(s.id);
                    setStaffUserId(null);
                    setNoPreference(false);
                    setSlot(null);
                    setStep("staff");
                  }}
                  className="flex w-full items-start justify-between gap-4 rounded-xl border border-border bg-card p-4 text-left transition-colors hover:border-primary/60 hover:bg-accent/30"
                >
                  <span className="min-w-0">
                    <span className="block font-medium" dir="auto">
                      {s.name}
                    </span>
                    {s.description && (
                      <span
                        className="mt-1 block line-clamp-2 text-sm text-muted-foreground"
                        dir="auto"
                      >
                        {s.description}
                      </span>
                    )}
                    <span className="mt-2 inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                      <Clock className="h-3.5 w-3.5" />
                      {s.duration_minutes} min
                    </span>
                  </span>
                  <span className="shrink-0 whitespace-nowrap font-display text-lg font-semibold text-primary">
                    {money(Number(s.price), s.currency)}
                  </span>
                </button>
              ))}
            </div>
          )}
        </>
      )}

      {/* ---------------- Step 3: staff ---------------- */}
      {step === "staff" && (
        <>
          <StepHeading
            title="Choose your stylist"
            subtitle={service?.name ?? undefined}
            onBack={() => setStep("service")}
          />
          {staffLoading ? (
            <div className="space-y-3">
              <Skeleton className="h-16 w-full" />
              <Skeleton className="h-16 w-full" />
            </div>
          ) : (
            <div className="space-y-3">
              <button
                type="button"
                onClick={() => {
                  setStaffUserId(null);
                  setNoPreference(true);
                  setSlot(null);
                  setStep("time");
                }}
                className="flex w-full items-center gap-3 rounded-xl border border-border bg-card p-4 text-left transition-colors hover:border-primary/60 hover:bg-accent/30"
              >
                <Sparkles className="h-5 w-5 shrink-0 text-primary" />
                <span>
                  <span className="block font-medium">No preference</span>
                  <span className="block text-sm text-muted-foreground">
                    We'll match you with the first available specialist.
                  </span>
                </span>
              </button>

              {staffOptions.map((st) => (
                <button
                  key={st.user_id}
                  type="button"
                  onClick={() => {
                    setStaffUserId(st.user_id);
                    setNoPreference(false);
                    setSlot(null);
                    setStep("time");
                  }}
                  className="flex w-full items-center gap-3 rounded-xl border border-border bg-card p-4 text-left transition-colors hover:border-primary/60 hover:bg-accent/30"
                >
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent/40">
                    <User className="h-4 w-4 text-primary" />
                  </span>
                  <span className="font-medium" dir="auto">
                    {st.full_name}
                  </span>
                </button>
              ))}

              {staffOptions.length === 0 && (
                <p className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">
                  No specific stylist is listed for this service — continue with “No preference”.
                </p>
              )}
            </div>
          )}
        </>
      )}

      {/* ---------------- Step 4: time ---------------- */}
      {step === "time" && location && service && (
        <>
          <StepHeading
            title="Pick a time"
            subtitle={`${service.name} · ${service.duration_minutes} min`}
            onBack={() => setStep("staff")}
          />
          <SlotPicker
            brandId={brand!.id}
            locationId={location.id}
            serviceId={service.id}
            staffUserId={noPreference ? null : staffUserId}
            maxAdvanceDays={brand!.max_advance_days}
            selectedIso={slot?.starts_at ?? null}
            refreshKey={slotRefresh}
            onSelect={(s) => {
              setSlot(s);
              setStep("verify");
            }}
          />
        </>
      )}

      {/* ---------------- Step 5: verify + confirm ---------------- */}
      {step === "verify" && location && service && slot && (
        <VerifyStep
          brandId={brand!.id}
          locationId={location.id}
          serviceId={service.id}
          staffUserId={noPreference ? slot.staff_user_id : staffUserId}
          slot={slot}
          summary={{
            serviceName: service.name,
            locationName: location.name,
            price: money(Number(service.price), service.currency),
          }}
          onBack={() => setStep("time")}
          onSlotTaken={() => {
            setSlot(null);
            setSlotRefresh((n) => n + 1);
            setStep("time");
            toast.error("That time was just taken", {
              description: "We've refreshed the list — please pick another slot.",
            });
          }}
          onDone={(r) => {
            setResult(r);
            setStep("done");
          }}
        />
      )}

      {/* ---------------- Done ---------------- */}
      {step === "done" && result && slot && service && location && (
        <div className="py-4">
          <div className="mb-6 flex flex-col items-center text-center">
            <span className="mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-primary/10">
              <Check className="h-7 w-7 text-primary" />
            </span>
            <h1 className="font-display text-3xl font-semibold tracking-tight">
              You're booked
            </h1>
            <p className="mt-2 text-sm text-muted-foreground">
              A confirmation {result.smsSent ? "has been sent to your phone" : "is ready below"}.
            </p>
          </div>

          <div className="rounded-xl border border-border bg-card p-5">
            <dl className="space-y-3 text-sm">
              <Row label="Service" value={service.name} />
              <Row
                label="When"
                value={format(parseISO(slot.starts_at), "EEEE d MMMM · HH:mm")}
              />
              <Row label="Location" value={location.name} />
              <Row label="Price" value={money(Number(service.price), service.currency)} />
            </dl>
          </div>

          <div className="mt-5 rounded-xl border border-dashed border-border bg-accent/20 p-5">
            <p className="text-sm font-medium">Manage your booking</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Use this private link to reschedule or cancel.
            </p>
            <div className="mt-3 flex flex-col gap-2 sm:flex-row">
              <Input readOnly value={result.manageUrl} className="text-xs" />
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  void navigator.clipboard.writeText(result.manageUrl);
                  toast.success("Link copied");
                }}
              >
                Copy
              </Button>
            </div>
            {!result.smsSent && (
              <p className="mt-3 text-xs text-muted-foreground">
                SMS delivery isn't configured for this salon yet — please save this link.
              </p>
            )}
          </div>
        </div>
      )}
    </BookingShell>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-right font-medium" dir="auto">
        {value}
      </dd>
    </div>
  );
}

function VerifyStep({
  brandId,
  locationId,
  serviceId,
  staffUserId,
  slot,
  summary,
  onBack,
  onDone,
  onSlotTaken,
}: {
  brandId: string;
  locationId: string;
  serviceId: string;
  staffUserId: string | null;
  slot: PublicSlot;
  summary: { serviceName: string; locationName: string; price: string };
  onBack: () => void;
  onDone: (r: { manageUrl: string; smsSent: boolean }) => void;
  onSlotTaken: () => void;
}) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [notes, setNotes] = useState("");
  const [code, setCode] = useState("");
  const [sent, setSent] = useState(false);
  const [devCode, setDevCode] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function sendCode() {
    if (!name.trim()) {
      toast.error("Please enter your name.");
      return;
    }
    setBusy(true);
    try {
      const res = await requestBookingOtp({ data: { brandId, phone } });
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

  async function submit() {
    setBusy(true);
    try {
      const res = await confirmBooking({
        data: {
          brandId,
          locationId,
          serviceId,
          staffUserId,
          startsAt: slot.starts_at,
          name: name.trim(),
          phone,
          code: code.trim(),
          notes: notes.trim() || null,
        },
      });

      if (!res.ok) {
        if (res.error === "slot_taken" || res.error === "no_staff_available") {
          onSlotTaken();
          return;
        }
        toast.error(
          res.error === "bad_code"
            ? "That code isn't right or has expired."
            : res.error === "invalid_phone"
              ? "That phone number isn't valid."
              : "We couldn't complete your booking.",
        );
        return;
      }

      onDone({ manageUrl: res.manageUrl, smsSent: res.smsSent });
    } catch (err) {
      toast.error("Could not complete booking", {
        description: errorMessage(err, "Please try again."),
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <StepHeading
        title="Confirm your booking"
        subtitle="We'll text you a code to verify your number."
        onBack={onBack}
      />

      <div className="mb-6 rounded-xl border border-border bg-card p-4">
        <dl className="space-y-2.5 text-sm">
          <Row label="Service" value={summary.serviceName} />
          <Row
            label="When"
            value={format(parseISO(slot.starts_at), "EEEE d MMMM · HH:mm")}
          />
          <Row label="Location" value={summary.locationName} />
          <Row label="Price" value={summary.price} />
        </dl>
      </div>

      <div className="space-y-4">
        <div>
          <Label htmlFor="bk-name">Your name</Label>
          <Input
            id="bk-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Full name"
            dir="auto"
            disabled={sent}
            autoComplete="name"
          />
        </div>

        <div>
          <Label htmlFor="bk-phone">Mobile number</Label>
          <Input
            id="bk-phone"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="+974 5555 1234"
            inputMode="tel"
            autoComplete="tel"
            disabled={sent}
          />
        </div>

        {!sent && (
          <div>
            <Label htmlFor="bk-notes">Anything we should know? (optional)</Label>
            <Textarea
              id="bk-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              dir="auto"
            />
          </div>
        )}

        {sent && (
          <div>
            <Label htmlFor="bk-code">Verification code</Label>
            <Input
              id="bk-code"
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
            <button
              type="button"
              onClick={() => {
                setSent(false);
                setCode("");
                setDevCode(null);
              }}
              className="mt-2 text-xs text-muted-foreground underline underline-offset-4"
            >
              Change my details
            </button>
          </div>
        )}

        <Button
          className="h-12 w-full text-base"
          disabled={busy || (!sent && phone.trim().length < 6) || (sent && code.length < 4)}
          onClick={sent ? submit : sendCode}
        >
          {busy ? "Please wait…" : sent ? "Confirm booking" : "Send verification code"}
        </Button>

        <p className="text-center text-xs text-muted-foreground">
          We only use your number to confirm and manage this booking.
        </p>
      </div>
    </>
  );
}
