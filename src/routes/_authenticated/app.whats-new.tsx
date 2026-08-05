import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft, Check, Clock } from "lucide-react";

import { AppShell } from "@/components/app-shell";
import { LIVE, UPCOMING } from "@/lib/capabilities";

export const Route = createFileRoute("/_authenticated/app/whats-new")({
  head: () => ({
    meta: [{ title: "What's in Q-Salon Suite" }, { name: "robots", content: "noindex" }],
  }),
  component: WhatsNewPage,
});

/**
 * Capability inventory, moved off the daily dashboard.
 *
 * The split below is the whole point of this page: what a salon can rely on
 * today, and what is built but not yet switched on. Merging the two into one
 * undifferentiated feature list would be a promise the product can't keep —
 * a receptionist who reads "WhatsApp reminders" as live will stop phoning
 * clients, and the reminders won't go.
 *
 * The two lists themselves now live in `@/lib/capabilities`, because the public
 * landing page renders the same split for prospects. Keeping one copy means a
 * feature can never be "not yet switched on" here and "working today" there.
 */

function WhatsNewPage() {
  return (
    <AppShell>
      <div className="mx-auto max-w-4xl px-5 py-8 md:px-10 md:py-12">
        <Link
          to="/app"
          className="inline-flex items-center gap-[var(--space-xs)] text-sm text-muted-foreground transition-[color,background-color,border-color] duration-[var(--dur-fast)] ease-[var(--ease-out)] hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-focus)]"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Dashboard
        </Link>

        <h1 className="mt-[var(--space-lg)] font-display text-[length:var(--text-display)] font-medium tracking-tight">
          What this suite does
        </h1>
        <p className="mt-[var(--space-sm)] max-w-[60ch] text-sm leading-relaxed text-muted-foreground">
          Everything below either works today or is honestly marked as not yet switched on. Nothing
          in the first list is a promise.
        </p>

        <section aria-labelledby="live-heading" className="mt-[var(--space-2xl)]">
          <div className="flex items-baseline gap-[var(--space-sm)]">
            <h2
              id="live-heading"
              className="font-display text-[length:var(--text-display-s)] font-medium"
            >
              Working today
            </h2>
            <span className="text-xs tabular-nums text-muted-foreground">{LIVE.length}</span>
          </div>

          <ul className="mt-[var(--space-md)] grid gap-px overflow-hidden rounded-[var(--radius)] border border-border bg-border sm:grid-cols-2">
            {LIVE.map((c) => (
              <li key={c.title} className="bg-card p-[var(--space-md)]">
                <div className="flex items-start gap-[var(--space-xs)]">
                  <Check
                    aria-hidden="true"
                    className="mt-0.5 h-4 w-4 shrink-0 text-[var(--color-status-live)]"
                  />
                  <div className="min-w-0">
                    <h3 className="font-display text-base font-medium leading-snug">{c.title}</h3>
                    <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{c.detail}</p>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </section>

        {/* Deliberately a different visual language, not a badge on the same
            card shape: dashed rule, no fill, muted mark. Someone skimming must
            not be able to mistake this block for the one above. */}
        <section aria-labelledby="upcoming-heading" className="mt-[var(--space-2xl)]">
          <div className="flex items-baseline gap-[var(--space-sm)]">
            <h2
              id="upcoming-heading"
              className="font-display text-[length:var(--text-display-s)] font-medium text-muted-foreground"
            >
              Built, not yet switched on
            </h2>
            <span className="text-xs tabular-nums text-muted-foreground">{UPCOMING.length}</span>
          </div>
          <p className="mt-[var(--space-xs)] max-w-[60ch] text-sm text-muted-foreground">
            These exist in the product but are not running for your salon yet. Don't rely on them
            with clients.
          </p>

          <ul className="mt-[var(--space-md)] space-y-[var(--space-sm)]">
            {UPCOMING.map((c) => (
              <li
                key={c.title}
                className="rounded-[var(--radius)] border border-dashed border-border p-[var(--space-md)]"
              >
                <div className="flex items-start gap-[var(--space-xs)]">
                  <Clock
                    aria-hidden="true"
                    className="mt-0.5 h-4 w-4 shrink-0 text-[var(--color-status-upcoming)]"
                  />
                  <div className="min-w-0">
                    <h3 className="font-display text-base font-medium leading-snug text-muted-foreground">
                      {c.title}
                    </h3>
                    <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{c.detail}</p>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </section>

        <p className="mt-[var(--space-2xl)] border-t border-border pt-[var(--space-md)] text-xs text-muted-foreground">
          Q-Salon Suite · Doha
        </p>
      </div>
    </AppShell>
  );
}
