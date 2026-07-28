import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";

import logo from "@/assets/logo.png";

/**
 * Public storefront chrome for the client-facing booking portal.
 * Deliberately distinct from the internal AppShell: no sidebar, no nav,
 * generous whitespace, single-column and mobile-first.
 */
export function BookingShell({
  brandName,
  children,
  footerSlot,
}: {
  brandName?: string | null;
  children: ReactNode;
  footerSlot?: ReactNode;
}) {
  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border/60 bg-card/60 backdrop-blur">
        <div className="mx-auto flex max-w-2xl items-center gap-3 px-5 py-4">
          <img src={logo} alt="" className="h-9 w-9 rounded-full" />
          <div className="min-w-0">
            <p className="truncate font-display text-lg font-semibold leading-tight" dir="auto">
              {brandName ?? "Book an appointment"}
            </p>
            <p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
              Online booking
            </p>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-2xl px-5 pb-24 pt-6">{children}</main>

      <footer className="border-t border-border/60 py-8">
        <div className="mx-auto max-w-2xl space-y-2 px-5 text-center">
          {footerSlot}
          <p className="text-xs text-muted-foreground">
            Powered by{" "}
            <Link to="/" className="underline underline-offset-4 hover:text-foreground">
              Q-Salon Suite
            </Link>
          </p>
        </div>
      </footer>
    </div>
  );
}

export function Stepper({ step, total }: { step: number; total: number }) {
  return (
    <div className="mb-6 flex items-center gap-1.5" aria-label={`Step ${step} of ${total}`}>
      {Array.from({ length: total }, (_, i) => (
        <span
          key={i}
          className={`h-1 flex-1 rounded-full transition-colors ${
            i < step ? "bg-primary" : "bg-border"
          }`}
        />
      ))}
    </div>
  );
}

export function StepHeading({
  title,
  subtitle,
  onBack,
}: {
  title: string;
  subtitle?: string;
  onBack?: () => void;
}) {
  return (
    <div className="mb-5">
      {onBack && (
        <button
          type="button"
          onClick={onBack}
          className="mb-3 text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
        >
          ← Back
        </button>
      )}
      <h1 className="font-display text-2xl font-semibold tracking-tight sm:text-3xl">{title}</h1>
      {subtitle && <p className="mt-1.5 text-sm text-muted-foreground">{subtitle}</p>}
    </div>
  );
}
