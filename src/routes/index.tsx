import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useRef } from "react";
import { ArrowRight, Check, Clock } from "lucide-react";

import { Logo } from "@/components/logo";
import { LIVE, UPCOMING } from "@/lib/capabilities";
import {
  EXTRA_LOCATION_ADDON,
  PLAN_FEATURES,
  PLAN_LIMITS,
  PLAN_ORDER,
  formatQar,
  isUnlimited,
  type PlanTier,
} from "@/lib/plan-limits";

/* ---------------------------------------------------------------------------
 * Hallmark · genre: atmospheric (light-paper / Bloom exception)
 * macrostructure: Split Studio · design-system: design.md · designed-as-app
 * theme: locked (Warm Sand paper · Rose Gold accent · Cormorant + Karla)
 * nav: N5 floating pill · footer: Ft5 statement
 * enrichment: E8 hero photography (real stock, no polish pattern)
 * motion: hero entrance (staggered opacity) + one reveal per outcome block
 * pre-emit critique: P5 H5 E4 S5 R4 V5
 *
 * Why this shape, and not the numbered stages that were here:
 * the previous pass was accurate and cold. It explained mechanics to someone
 * who had not yet been given a reason to care, and put the honesty disclosures
 * directly beside the pitch, where they competed with it. Split Studio pairs
 * one wanted outcome with one piece of proof per block, so the reason comes
 * first and the mechanism follows inside the same breath.
 *
 * Nothing factual was removed to make room. The capability split, the plan
 * limits and the operational facts are all still here, below the persuasion
 * instead of on top of it.
 *
 * The one standing honesty trap in warm copy: fewer no-shows is attributed
 * only to deposits, which ship today — never to WhatsApp reminders, which are
 * built but not sending. See design.md § Copy rules.
 * ------------------------------------------------------------------------ */

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Q-Salon Suite — salon management for Qatar" },
      {
        name: "description",
        content:
          "Booking, deposits, stock and reporting for beauty salons in Qatar. One brand, every branch, priced in QAR.",
      },
    ],
  }),
  component: Landing,
});

function Landing() {
  return (
    <div className="relative min-h-screen bg-background text-foreground">
      <BloomCanvas />
      <PublicNav />
      <main>
        <Hero />
        <Outcomes />
        <Plans />
        <BeforeYouSign />
      </main>
      <SiteFooter />
    </div>
  );
}

/* Shared voice ------------------------------------------------------------ */

const SHELL = "mx-auto w-full max-w-6xl px-5 md:px-10";

const BUTTON_BASE =
  "inline-flex h-12 items-center justify-center gap-2 whitespace-nowrap rounded-full px-5 text-sm font-medium transition-[color,background-color,border-color,box-shadow] duration-[var(--dur-fast)] ease-[var(--ease-out)] active:translate-y-px focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-focus)] sm:px-7";

/**
 * Fills with `--color-accent-fill`, not `--primary`: white on `--primary`
 * measures 2.94:1, under the 4.5:1 a button label needs. Pill-rounded here
 * where the app uses a 6px radius — atmospheric's softer register, applied to
 * the marketing surface only.
 */
const BUTTON_PRIMARY = `${BUTTON_BASE} bg-accent-fill text-primary-foreground shadow-[0_1px_2px_rgba(0,0,0,0.08)] hover:bg-accent-press hover:shadow-[0_6px_20px_-6px_oklch(0.56_0.11_55_/_0.5)]`;

const BUTTON_QUIET = `${BUTTON_BASE} border border-border bg-card/70 text-foreground backdrop-blur-sm hover:bg-card`;

/** No display utility — see the nav's `hidden sm:inline` note in git history. */
const LINK_QUIET =
  "whitespace-nowrap py-3 -my-3 text-sm text-muted-foreground underline underline-offset-4 transition-[color] duration-[var(--dur-fast)] ease-[var(--ease-out)] hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-focus)]";

/**
 * Fades a block in the first time it reaches the viewport, then stops.
 *
 * Three deliberate properties, each fixing a way this pattern usually breaks:
 *
 * 1. **Visible by default.** The element carries no `data-reveal` until this
 *    hook runs on the client, so server-rendered HTML reads fine with no JS.
 *    Hiding is applied by script and only to blocks actually below the fold —
 *    a block already on screen at mount is left alone, so there is no flash.
 * 2. **One-shot.** Re-animating on every scroll-by is the "page never settles"
 *    tell, and someone scrolling back up should find the page as they left it.
 * 3. **It cannot strand content.** A plain observer only reports *changes*, so
 *    jumping past a block — anchor link, End key, a fast flick — can leave it
 *    hidden forever. The passive scroll listener is the safety net: it reveals
 *    on geometry rather than on an event that may never arrive.
 */
function useReveal<T extends HTMLElement>() {
  const ref = useRef<T>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    // No observer, or the visitor asked for less motion: leave it visible.
    if (
      typeof IntersectionObserver === "undefined" ||
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ) {
      return;
    }

    // Already in view (or above it) at mount — nothing to reveal.
    if (el.getBoundingClientRect().top < window.innerHeight * 0.9) return;

    el.setAttribute("data-reveal", "pending");

    let raf = 0;
    const done = () => {
      io.disconnect();
      window.removeEventListener("scroll", safetyNet);
      // A frame between `pending` and `in` so the transition actually runs;
      // setting both in one tick would snap.
      raf = requestAnimationFrame(() => el.setAttribute("data-reveal", "in"));
    };

    const safetyNet = () => {
      if (el.getBoundingClientRect().top < window.innerHeight) done();
    };

    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) done();
      },
      // Fires slightly before the block is fully in view, so the fade has
      // finished by the time the reader's eye arrives. threshold 0 — any
      // overlap counts, because a tall block may never reach a ratio floor.
      { rootMargin: "0px 0px -10% 0px", threshold: 0 },
    );

    io.observe(el);
    window.addEventListener("scroll", safetyNet, { passive: true });

    return () => {
      io.disconnect();
      window.removeEventListener("scroll", safetyNet);
      cancelAnimationFrame(raf);
    };
  }, []);

  return ref;
}

function Wordmark({
  size = 28,
  className = "",
  compact = false,
}: {
  size?: number;
  className?: string;
  compact?: boolean;
}) {
  return (
    <span className={`flex items-center gap-[var(--space-xs)] ${className}`}>
      <Logo size={size} />
      <span
        className={`whitespace-nowrap font-display text-lg font-medium tracking-tight sm:text-xl ${
          compact ? "max-[399px]:hidden" : ""
        }`}
      >
        Q-Salon Suite
      </span>
    </span>
  );
}

/* Canvas ------------------------------------------------------------------
 * Two fixed warm blooms. Atmospheric loosens the accent-footprint gate to
 * allow this; the chroma is kept low so it reads as light in the room rather
 * than as a coloured background. Fixed, never animated — a drifting gradient
 * is the aurora-blob tell.
 * ------------------------------------------------------------------------ */

function BloomCanvas() {
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none fixed inset-0 -z-10"
      style={{
        background:
          "radial-gradient(70rem 45rem at 78% -8%, var(--bloom-warm), transparent 62%), radial-gradient(55rem 40rem at 8% 32%, var(--bloom-sand), transparent 65%)",
      }}
    />
  );
}

/* Nav · N5 floating pill --------------------------------------------------- */

function PublicNav() {
  return (
    <header className="sticky top-0 z-30 px-3 pt-3 md:px-6 md:pt-5">
      <div className="mx-auto flex h-16 w-full max-w-5xl items-center justify-between gap-3 rounded-full border border-border/70 bg-card/70 pl-4 pr-2 shadow-[0_2px_18px_-8px_rgba(0,0,0,0.16)] backdrop-blur-md md:pl-6 md:pr-3">
        <Link
          to="/"
          className="inline-flex min-w-0 items-center rounded-full py-2 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--color-focus)]"
        >
          <Wordmark compact />
        </Link>

        <div className="flex items-center gap-[var(--space-md)]">
          <Link to="/auth" className={`hidden sm:inline ${LINK_QUIET}`}>
            Sign in
          </Link>
          <Link to="/auth" search={{ mode: "signup" }} className={`${BUTTON_PRIMARY} h-11`}>
            Request access
          </Link>
        </div>
      </div>
    </header>
  );
}

/* Hero · E8 photography ----------------------------------------------------
 * PLACEHOLDER PHOTOGRAPHY — replace before launch.
 *
 * Unsplash Licence (free commercial use, no attribution required); credited
 * here as a courtesy and so the provenance survives.
 *   salon-gold-mirrors.jpg   — unsplash.com/photos/vSZbEjCSDRw
 *   salon-mirror-detail.jpg  — Giorgio Trovato, unsplash.com/photos/gI9rvJK61L8
 *
 * Chosen for what it does NOT contain as much as what it does: no people, no
 * signage, no third-party branding. A visibly Western salon team on a page
 * selling to Doha reads as imported, and a photo carrying another business's
 * name reads as a customer we don't have. Both would undo the honesty the
 * rest of this page is built on. Swap for real photography of a client salon
 * as soon as one is willing.
 * ------------------------------------------------------------------------ */

function Hero() {
  return (
    <section
      className={`${SHELL} pb-[var(--space-3xl)] pt-[var(--space-2xl)] md:pb-[calc(var(--space-3xl)*1.6)] md:pt-[var(--space-3xl)]`}
    >
      <div className="grid items-center gap-[var(--space-xl)] lg:grid-cols-12 lg:gap-[var(--space-2xl)]">
        <div className="lg:col-span-6">
          <h1
            data-entrance
            style={{ "--i": 0 } as React.CSSProperties}
            className="max-w-[15ch] font-display text-[length:var(--text-hero)] font-medium leading-[1.04] tracking-tight"
          >
            Fuller chairs. A calmer front desk.
          </h1>

          <p
            data-entrance
            style={{ "--i": 1 } as React.CSSProperties}
            className="mt-[var(--space-lg)] max-w-[52ch] text-base leading-relaxed text-muted-foreground md:text-lg"
          >
            Q-Salon Suite takes the booking, holds the deposit, counts the stock and adds up the day
            — so your team spends it with clients instead of with the diary.
          </p>

          <div
            data-entrance
            style={{ "--i": 2 } as React.CSSProperties}
            className="mt-[var(--space-xl)] flex flex-wrap items-center gap-[var(--space-sm)]"
          >
            <Link to="/auth" search={{ mode: "signup" }} className={BUTTON_PRIMARY}>
              Request access
              <ArrowRight aria-hidden="true" className="h-4 w-4" />
            </Link>
            <a href="#plans" className={BUTTON_QUIET}>
              See plans
            </a>
          </div>

          <p
            data-entrance
            style={{ "--i": 3 } as React.CSSProperties}
            className="mt-[var(--space-md)] text-sm text-muted-foreground"
          >
            Built in Doha, priced in riyals. No card to start.
          </p>
        </div>

        {/* Lands last, after the words have settled. */}
        <figure data-entrance style={{ "--i": 4 } as React.CSSProperties} className="lg:col-span-6">
          <img
            src="/img/salon-gold-mirrors.jpg"
            alt="A beauty salon in cream and gold: carved white mirrors along a sand-coloured wall, lit by warm wall lamps."
            width={1800}
            height={1200}
            /* LCP element — never lazy, always high priority. */
            fetchPriority="high"
            decoding="async"
            className="aspect-[4/3] w-full rounded-[var(--radius-2xl)] object-cover shadow-[0_24px_60px_-32px_rgba(0,0,0,0.4)]"
          />
        </figure>
      </div>
    </section>
  );
}

/* Outcomes · Split Studio --------------------------------------------------
 * Each block: the thing an owner wants, then the mechanism that delivers it.
 * Direction alternates so the page has a rhythm rather than a column.
 *
 * PLACEHOLDER PHOTOGRAPHY — replace before launch.
 *   salon-interior-brick.jpg — Unsplash Licence, unsplash.com/photos/LGXN4OSQSa4
 *   Cropped server-side to remove a real salon's signage from frame: leaving
 *   another business's name in shot would read as a customer we don't have.
 * ------------------------------------------------------------------------ */

type Outcome = {
  title: string;
  body: string;
  aside: string[];
  image?: { src: string; alt: string };
};

const OUTCOMES: Outcome[] = [
  {
    title: "The client who books at midnight",
    body: "Your booking page is open when you are not. Clients pick a real slot from your actual rotas and approved leave, confirm by phone so you know it is a person, and the database itself refuses to sell the same chair twice. You open to a full morning instead of a voicemail queue.",
    aside: [
      "Live availability from real staff schedules",
      "Phone-verified before it books",
      "Double-booking blocked in the database",
    ],
    image: {
      src: "/img/salon-interior-brick.jpg",
      alt: "A salon interior with warm exposed brick, wood-slat panelling, and lit mirrors along the wall.",
    },
  },
  {
    title: "The no-show that costs you nothing",
    body: "Ask for a deposit on the treatments that hurt most when they vanish — flat or a percentage, your call, set per service. Cancel in good time and it refunds itself automatically. Leave it too late and it does not. Nobody at the desk has to have that conversation.",
    aside: [
      "Per service, flat or percentage",
      "Refunded automatically inside your window",
      "Forfeited outside it, with no chasing",
    ],
  },
  {
    title: "Closing time, already counted",
    body: "Finishing a service takes the products it used out of that branch's stock. A gift card or a prepaid package is spotted at the till and offered before anyone has to remember it. By the time the last client leaves, the takings, the stock and the staff numbers are already there.",
    aside: [
      "Stock deducted as work is completed",
      "Packages and gift cards found at checkout",
      "Revenue by branch, scoped to the role",
    ],
    image: {
      src: "/img/salon-mirror-detail.jpg",
      alt: "A round gold-rimmed mirror above a salon counter of styling products, in soft daylight.",
    },
  },
];

function Outcomes() {
  return (
    <section aria-label="What changes in the salon" className="pb-[var(--space-3xl)]">
      <div className={`${SHELL} flex flex-col gap-[var(--space-3xl)]`}>
        {OUTCOMES.map((o, i) => (
          <OutcomeBlock key={o.title} outcome={o} flip={i % 2 === 1} />
        ))}
      </div>
    </section>
  );
}

function OutcomeBlock({ outcome, flip }: { outcome: Outcome; flip: boolean }) {
  const ref = useReveal<HTMLDivElement>();

  return (
    <div
      ref={ref}
      className="grid items-center gap-[var(--space-lg)] lg:grid-cols-12 lg:gap-[var(--space-2xl)]"
    >
      <div className={`lg:col-span-6 ${flip ? "lg:order-2" : ""}`}>
        <h2 className="max-w-[18ch] font-display text-[length:var(--text-display)] font-medium leading-tight tracking-tight">
          {outcome.title}
        </h2>
        <p className="mt-[var(--space-md)] max-w-[58ch] text-base leading-relaxed text-muted-foreground">
          {outcome.body}
        </p>

        <ul className="mt-[var(--space-lg)] space-y-[var(--space-xs)]">
          {outcome.aside.map((a) => (
            <li key={a} className="flex items-start gap-[var(--space-xs)] text-sm">
              <Check
                aria-hidden="true"
                className="mt-0.5 h-4 w-4 shrink-0 text-[var(--color-status-live)]"
              />
              <span className="min-w-0 text-muted-foreground">{a}</span>
            </li>
          ))}
        </ul>
      </div>

      <div className={`lg:col-span-6 ${flip ? "lg:order-1" : ""}`}>
        {outcome.image ? (
          <img
            src={outcome.image.src}
            alt={outcome.image.alt}
            width={1600}
            height={1297}
            loading="lazy"
            decoding="async"
            className="aspect-[5/4] w-full rounded-[var(--radius-2xl)] object-cover shadow-[0_24px_60px_-34px_rgba(0,0,0,0.38)]"
          />
        ) : (
          /* No photograph for the deposits block, deliberately. Three photos
             in three blocks reads as decoration; the gap gives the page a
             breath and lets the middle outcome carry on words alone. */
          <div className="rounded-[var(--radius-2xl)] border border-border bg-card/60 p-[var(--space-xl)] backdrop-blur-sm">
            <p className="font-display text-[length:var(--text-display-s)] font-medium leading-snug">
              A deposit is the only thing on this page that reliably reduces no-shows today.
            </p>
            <p className="mt-[var(--space-sm)] text-sm leading-relaxed text-muted-foreground">
              WhatsApp reminders are built, but not sending yet — so we are not going to claim them.
              They are listed with everything else further down.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

/* Plans · limits folded in ------------------------------------------------- */

function planScope(tier: PlanTier) {
  const { locations, staff } = PLAN_LIMITS[tier];
  const loc = isUnlimited(locations)
    ? "Unlimited locations"
    : `${locations} ${locations === 1 ? "location" : "locations"}`;
  const seats = isUnlimited(staff) ? "unlimited staff" : `${staff} staff accounts`;
  return `${loc} · ${seats}`;
}

function Plans() {
  return (
    <section
      id="plans"
      aria-labelledby="plans-heading"
      className={`${SHELL} scroll-mt-24 pb-[var(--space-3xl)]`}
    >
      <h2
        id="plans-heading"
        className="max-w-[18ch] font-display text-[length:var(--text-display)] font-medium tracking-tight"
      >
        Priced by how many chairs you run.
      </h2>
      <p className="mt-[var(--space-sm)] max-w-[58ch] text-sm leading-relaxed text-muted-foreground">
        Staff accounts are counted separately from your own Owner login, and the limits below are
        enforced by the database — a plan cannot quietly be exceeded. Invoiced by hand in QAR while
        v1 settles, so there is no card to store and nothing renews on its own.
      </p>

      {/* Four tiers: 2-up on tablet, 4-up on desktop. Deliberately identical
          treatment — no "most popular" badge, since there is no usage data to
          justify one and inventing the claim is the same lie as an invented
          metric. */}
      <div className="mt-[var(--space-xl)] grid gap-[var(--space-md)] sm:grid-cols-2 lg:grid-cols-4">
        {PLAN_ORDER.map((tier) => {
          const plan = PLAN_LIMITS[tier];
          const priced = plan.priceMonthly !== null;
          return (
            <div
              key={tier}
              className="flex flex-col rounded-[var(--radius-2xl)] border border-border bg-card/70 p-[var(--space-lg)] backdrop-blur-sm"
            >
              <h3 className="font-display text-[length:var(--text-display-s)] font-medium">
                {plan.label}
              </h3>
              <p className="mt-[var(--space-2xs)] text-sm text-muted-foreground">
                {planScope(tier)}
              </p>

              <p className="mt-[var(--space-md)] flex flex-wrap items-baseline gap-[var(--space-2xs)]">
                <span className="font-display text-[length:var(--text-display-s)] font-medium leading-none [overflow-wrap:normal]">
                  {priced ? formatQar(plan.priceMonthly!) : "Contact sales"}
                </span>
                {priced && <span className="text-sm text-muted-foreground">/month</span>}
              </p>
              {plan.priceYearly !== null && (
                <p className="mt-[var(--space-2xs)] text-xs text-muted-foreground">
                  or {formatQar(plan.priceYearly)}/year
                </p>
              )}

              <ul className="mt-[var(--space-lg)] flex-1 space-y-[var(--space-xs)]">
                {PLAN_FEATURES[tier].map((f) => (
                  <li key={f} className="flex items-start gap-[var(--space-xs)]">
                    <Check
                      aria-hidden="true"
                      className="mt-0.5 h-4 w-4 shrink-0 text-[var(--color-status-live)]"
                    />
                    <span className="min-w-0 text-sm leading-snug text-muted-foreground">{f}</span>
                  </li>
                ))}
              </ul>

              {/* Rendered from the same flag the admin form and the database
                  ceiling use, so a tier can never advertise an add-on it
                  cannot actually be given. */}
              {plan.addonEligible && (
                <p className="mt-[var(--space-md)] border-t border-dashed border-border pt-[var(--space-sm)] text-xs leading-relaxed text-muted-foreground">
                  Need another branch? Add extra locations for{" "}
                  <span className="font-medium text-foreground">
                    {formatQar(EXTRA_LOCATION_ADDON.priceMonthly)}/month
                  </span>{" "}
                  each.
                </p>
              )}

              {/* A tier with no published price cannot be self-started —
                  sending someone to sign-up for it would strand them at a
                  price they were never quoted. */}
              <Link
                to="/auth"
                search={{ mode: "signup" }}
                className={`mt-[var(--space-lg)] ${BUTTON_QUIET}`}
              >
                {priced ? `Start on ${plan.label}` : "Talk to us"}
              </Link>
            </div>
          );
        })}
      </div>
    </section>
  );
}

/* Before you sign ---------------------------------------------------------
 * The honesty section, moved off the pitch rather than out of the page. Every
 * fact that used to sit beside the hero is still here — the full capability
 * split, what is not switched on, and the operational specifics — just set
 * smaller and read later, by someone who has already decided they are
 * interested. Nothing here was cut.
 * ------------------------------------------------------------------------ */

const FACTS: { key: string; value: string }[] = [
  { key: "Currency", value: "QAR throughout, formatted for Qatar" },
  { key: "The week", value: "Starts Sunday, so weekly figures match yours" },
  { key: "Language", value: "English interface, Arabic-capable client fields" },
  { key: "Double-booking", value: "Refused by the database, not just the screen" },
  { key: "Roles", value: "Four fixed: Owner, Manager, Receptionist, Technician" },
  { key: "Separation", value: "One salon's data walled off per row, in the database" },
  { key: "Hosting", value: "Mumbai region — not inside Qatar" },
  { key: "Billing", value: "Invoiced by hand in v1, no card stored" },
];

function BeforeYouSign() {
  return (
    <section aria-labelledby="honest-heading" className="border-t border-border/70 bg-card/40">
      <div className={`${SHELL} py-[var(--space-2xl)]`}>
        <h2
          id="honest-heading"
          className="font-display text-[length:var(--text-display-s)] font-medium tracking-tight"
        >
          Before you sign
        </h2>
        <p className="mt-[var(--space-2xs)] max-w-[62ch] text-sm text-muted-foreground">
          The whole product, including the parts that are not running yet. We would rather you found
          this here than after the invoice.
        </p>

        <div className="mt-[var(--space-lg)] grid gap-[var(--space-lg)] lg:grid-cols-12 lg:gap-[var(--space-xl)]">
          <div className="lg:col-span-5">
            <h3 className="flex items-baseline gap-[var(--space-xs)] text-sm font-medium">
              Working today
              <span className="text-xs text-muted-foreground">{LIVE.length}</span>
            </h3>
            <ul className="mt-[var(--space-sm)] grid gap-x-[var(--space-md)] gap-y-1 sm:grid-cols-2 lg:grid-cols-1">
              {LIVE.map((c) => (
                <li
                  key={c.title}
                  className="flex items-start gap-[var(--space-2xs)] text-sm text-muted-foreground"
                >
                  <Check
                    aria-hidden="true"
                    className="mt-1 h-3 w-3 shrink-0 text-[var(--color-status-live)]"
                  />
                  <span className="min-w-0">{c.title}</span>
                </li>
              ))}
            </ul>
          </div>

          {/* Dashed, muted, clock-marked — deliberately a different visual
              language from the ticked list, so a skimmer cannot merge them. */}
          <div className="lg:col-span-3">
            <h3 className="flex items-baseline gap-[var(--space-xs)] text-sm font-medium text-muted-foreground">
              Not switched on
              <span className="text-xs">{UPCOMING.length}</span>
            </h3>
            <ul className="mt-[var(--space-sm)] space-y-[var(--space-xs)]">
              {UPCOMING.map((c) => (
                <li
                  key={c.title}
                  className="flex items-start gap-[var(--space-2xs)] rounded-[var(--radius)] border border-dashed border-border px-[var(--space-sm)] py-[var(--space-xs)] text-sm text-muted-foreground"
                >
                  <Clock
                    aria-hidden="true"
                    className="mt-1 h-3 w-3 shrink-0 text-[var(--color-status-upcoming)]"
                  />
                  <span className="min-w-0">{c.title}</span>
                </li>
              ))}
            </ul>
          </div>

          <div className="lg:col-span-4">
            <h3 className="text-sm font-medium">Worth checking</h3>
            <dl className="mt-[var(--space-sm)] space-y-[var(--space-xs)]">
              {FACTS.map((f) => (
                <div key={f.key} className="text-sm">
                  <dt className="sr-only">{f.key}</dt>
                  <dd className="text-muted-foreground">
                    <span className="text-foreground">{f.key}</span> · {f.value}
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        </div>
      </div>
    </section>
  );
}

/* Footer · Ft5 statement --------------------------------------------------- */

function SiteFooter() {
  return (
    <footer className="border-t border-border/70">
      <div className={`${SHELL} py-[var(--space-2xl)]`}>
        <p className="max-w-[26ch] font-display text-[length:var(--text-display)] font-medium leading-tight tracking-tight">
          Bring one branch across. Let the rest follow.
        </p>

        <div className="mt-[var(--space-xl)]">
          <Link to="/auth" search={{ mode: "signup" }} className={BUTTON_PRIMARY}>
            Request access
            <ArrowRight aria-hidden="true" className="h-4 w-4" />
          </Link>
        </div>

        <div className="mt-[var(--space-2xl)] flex flex-wrap items-center gap-x-[var(--space-lg)] gap-y-[var(--space-xs)] border-t border-border pt-[var(--space-md)]">
          <Wordmark size={22} />
          <Link to="/auth" className={LINK_QUIET}>
            Sign in
          </Link>
          <a href="#plans" className={LINK_QUIET}>
            Plans
          </a>
          <span className="ms-auto text-xs text-muted-foreground">
            © {new Date().getFullYear()} Q-Salon Suite · Doha
          </span>
        </div>
      </div>
    </footer>
  );
}
