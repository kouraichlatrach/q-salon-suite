import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { zodValidator, fallback } from "@tanstack/zod-adapter";
import { z } from "zod";

import { simulateMockPayment } from "@/lib/payments/mock-checkout.functions";
import { BookingShell, StepHeading } from "@/components/booking-shell";
import { Button } from "@/components/ui/button";
import { errorMessage } from "@/lib/error-message";

/**
 * Developer-only stand-in for a hosted gateway checkout page.
 *
 * This is what MockPaymentProvider.createCharge() points its checkout URL at.
 * Clicking an outcome fires a correctly-signed webhook into the real endpoint,
 * so the genuine verification + state-transition path is what gets exercised.
 * "Tampered signature" is included to prove the rejection path works too.
 */

// TanStack Router JSON-parses search values, so `amount=27.07` arrives as a
// number and `metadata={"a":"b"}` as an object — not strings. Declaring them as
// z.string() made every value fail validation and silently fall back to the
// defaults, which is why the page showed 0.00 QAR. Coerce so the schema accepts
// either shape.
const searchSchema = z.object({
  ref: fallback(z.coerce.string(), "").default(""),
  amount: fallback(z.coerce.number(), 0).default(0),
  currency: fallback(z.coerce.string(), "QAR").default("QAR"),
  description: fallback(z.coerce.string(), "").default(""),
  return_url: fallback(z.coerce.string(), "").default(""),
  metadata: fallback(z.record(z.string(), z.string()), {}).default({}),
});

export const Route = createFileRoute("/dev/mock-checkout")({
  validateSearch: zodValidator(searchSchema),
  head: () => ({
    meta: [
      { title: "Mock checkout (dev)" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: MockCheckoutPage,
});

type Outcome = { status: number; body: string } | null;

function MockCheckoutPage() {
  const search = Route.useSearch();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Outcome>(null);
  const [error, setError] = useState<string | null>(null);

  const amount = Number(search.amount) || 0;
  const metadata: Record<string, string> = search.metadata ?? {};

  async function fire(outcome: "succeeded" | "failed", tamper = false) {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const res = await simulateMockPayment({
        data: {
          ref: search.ref,
          outcome,
          amount,
          currency: search.currency,
          metadata,
          tamper,
        },
      });
      setResult({ status: res.status, body: res.body });
    } catch (err) {
      setError(errorMessage(err, "Could not reach the webhook endpoint.") ?? null);
    } finally {
      setBusy(false);
    }
  }

  if (!search.ref) {
    return (
      <BookingShell>
        <div className="py-16 text-center">
          <h1 className="font-display text-2xl font-semibold">Nothing to pay</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            This page is reached from a mock checkout link and needs a charge reference.
          </p>
        </div>
      </BookingShell>
    );
  }

  return (
    <BookingShell brandName="Mock gateway">
      <div className="mb-4 rounded-lg border border-dashed border-amber-400 bg-amber-50 p-3 text-xs text-amber-900">
        Developer tool — not a real payment page. No money moves. Each button
        sends a signed webhook to the app's real endpoint.
      </div>

      <StepHeading
        title="Simulate a payment"
        subtitle={search.description || "Booking deposit"}
      />

      <div className="rounded-xl border border-border bg-card p-5">
        <dl className="space-y-2.5 text-sm">
          <Row label="Amount" value={`${amount.toFixed(2)} ${search.currency}`} />
          <Row label="Charge ref" value={search.ref} mono />
          {metadata.appointment_id && (
            <Row label="Appointment" value={metadata.appointment_id} mono />
          )}
        </dl>
      </div>

      <div className="mt-6 flex flex-col gap-3">
        <Button className="h-12 text-base" disabled={busy} onClick={() => fire("succeeded")}>
          {busy ? "Sending…" : "Payment succeeded"}
        </Button>
        <Button
          variant="outline"
          className="h-12 text-base"
          disabled={busy}
          onClick={() => fire("failed")}
        >
          Payment failed
        </Button>
        <Button
          variant="ghost"
          className="h-10 text-xs text-muted-foreground"
          disabled={busy}
          onClick={() => fire("succeeded", true)}
        >
          Send with tampered signature (should be rejected)
        </Button>
      </div>

      {error && (
        <p className="mt-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-900">{error}</p>
      )}

      {result && (
        <div className="mt-4 rounded-md border border-border bg-muted/40 p-3">
          <p className="text-xs font-medium">
            Webhook responded {result.status}
            {result.status === 200 ? " (accepted)" : " (rejected)"}
          </p>
          <pre className="mt-2 overflow-x-auto text-[11px] leading-relaxed text-muted-foreground">
            {result.body}
          </pre>
          {search.return_url && result.status === 200 && (
            <a
              href={search.return_url}
              className="mt-3 inline-block text-sm underline underline-offset-4"
            >
              Continue to your booking →
            </a>
          )}
        </div>
      )}
    </BookingShell>
  );
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className={`text-right font-medium ${mono ? "font-mono text-xs" : ""}`}>{value}</dd>
    </div>
  );
}
