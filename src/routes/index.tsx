import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowRight, Check, Clock } from "lucide-react";

import { Logo } from "@/components/logo";
import { LIVE, UPCOMING } from "@/lib/capabilities";
import { PLAN_FEATURES, PLAN_LIMITS, type PlanTier } from "@/lib/plan-limits";

/* ---------------------------------------------------------------------------
 * Hallmark · genre: modern-minimal · macrostructure: Narrative Workflow
 * design-system: design.md · designed-as-app
 * theme: locked (Warm Sand paper · Rose Gold accent · Cormorant + Karla)
 * nav: N9 edge-aligned minimal · footer: Ft1 mast-headed
 * H2 hero knobs: ratio=7/5, right=proof-column, divider=hairline
 * F4 step knobs: numbering=01/02/03, layout=vertical-stack, connector=line
 * F3 spec knobs: columns=3 (key/value/footnote), rules=every-row, nums=tabular
 * enrichment: none — typography only
 * pre-emit critique: P5 H5 E4 S5 R5 V4
 *
 * Why this shape, and not the Bento Grid that was here:
 * a prospective owner does not yet know what this product IS. A grid of
 * feature tiles answers "what does it have"; a numbered sequence answers
 * "what happens in my salon", which is the question being asked. It also needs
 * no invented metrics, no testimonials and no product screenshots to stand up
 * — and this page had all three of the first kind before.
 *
 * Accent discipline: rose gold appears as button fill and focus rings only.
 * The old page used it as a full section background behind a fabricated
 * revenue chart; both are gone.
 * ------------------------------------------------------------------------ */

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Q-Salon Suite — salon management for Qatar" },
      {
        name: "description",
        content:
          "Appointments, clients, stock and reporting for beauty salons in Qatar. One brand, every location, four role levels, priced in QAR.",
      },
    ],
  }),
  component: Landing,
});

function Landing() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <PublicNav />
      <main>
        <Hero />
        <Stages />
        <SpecSheet />
        <NotYetOn />
        <Plans />
        <ClosingCta />
      </main>
      <SiteFooter />
    </div>
  );
}

/* Shared voice ------------------------------------------------------------ */

const SHELL = "mx-auto w-full max-w-6xl px-5 md:px-10";

/**
 * One button shape for the whole page, so the CTA voice matches the app's.
 * `whitespace-nowrap` is not cosmetic — a primary action that wraps to two
 * lines at 320px reads as a broken element rather than a button.
 */
const BUTTON_BASE =
  "inline-flex h-11 items-center justify-center gap-2 whitespace-nowrap rounded-[var(--radius)] px-4 text-sm font-medium transition-[color,background-color,border-color] duration-[var(--dur-fast)] ease-[var(--ease-out)] active:translate-y-px focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-focus)] sm:px-6";

/**
 * Fills with `--color-accent-fill`, not `--primary`.
 *
 * White on `--primary` measures 2.94:1, and on the old `rose-gold-deep` hover
 * 3.55:1 — both below the 4.5:1 a 14px button label needs. Same finding
 * design.md already recorded for the focus ring; it simply never reached the
 * button fills. Every filled `--primary` button elsewhere in the app has the
 * same problem and needs the same swap.
 */
const BUTTON_PRIMARY = `${BUTTON_BASE} bg-accent-fill text-primary-foreground hover:bg-accent-press`;

const BUTTON_QUIET = `${BUTTON_BASE} border border-border bg-card text-foreground hover:bg-secondary`;

/**
 * `py-3 -my-3` is a hit-target expander, not spacing.
 *
 * These links render at 20px tall, which is a fine reading size and an unfair
 * tap target on a phone. The padding lifts the touchable box to 44px and the
 * matching negative margin gives the space back to the layout, so nothing
 * moves visually.
 *
 * It also sets no `display` utility, deliberately. It used to open with
 * `inline-flex`, which the nav's `hidden sm:inline` could not override —
 * Tailwind resolves conflicting utilities by their order in the generated
 * stylesheet, not by their order in the class attribute, so the later-emitted
 * `inline-flex` won, "Sign in" stayed visible at 320px, and it pushed the
 * primary action off the right edge.
 */
const LINK_QUIET =
  "whitespace-nowrap py-3 -my-3 text-sm text-muted-foreground underline underline-offset-4 transition-[color,background-color,border-color] duration-[var(--dur-fast)] ease-[var(--ease-out)] hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-focus)]";

function Wordmark({
  size = 30,
  className = "",
  /**
   * Drops the lettering below 380px, leaving the mark alone.
   *
   * The nav is one row of two nowrap items; on the narrowest phones the
   * wordmark and the primary action together are ~3px wider than the gutter
   * allows, so the button kissed the screen edge. Losing the lettering for a
   * couple of hundred pixels of width is a better trade than shrinking the
   * only action on the page, and the mark still identifies the site.
   */
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
        className={`whitespace-nowrap font-display text-lg font-medium tracking-tight sm:text-xl md:text-2xl ${
          compact ? "max-[379px]:hidden" : ""
        }`}
      >
        Q-Salon Suite
      </span>
    </span>
  );
}

/* Nav · N9 edge-aligned minimal -------------------------------------------
 * Wordmark hard-left, actions hard-right, nothing in between. The empty
 * middle is the point: a five-link marketing bar is the most recognisable
 * templated shape there is, and this page's own numbered sequence already
 * does the navigating. No hamburger is needed because there is no link row
 * to hide — which also sidesteps the missing-mobile-nav bug the app shell hit.
 * ------------------------------------------------------------------------ */

function PublicNav() {
  return (
    <header className="border-b border-border">
      <div className={`${SHELL} flex h-20 items-center justify-between gap-4`}>
        <Link
          to="/"
          className="inline-flex min-w-0 items-center rounded-[var(--radius)] py-2 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--color-focus)]"
        >
          <Wordmark compact />
        </Link>

        <div className="flex items-center gap-[var(--space-md)]">
          <Link to="/auth" className={`hidden sm:inline ${LINK_QUIET}`}>
            Sign in
          </Link>
          <Link to="/auth" search={{ mode: "signup" }} className={BUTTON_PRIMARY}>
            Request access
          </Link>
        </div>
      </div>
    </header>
  );
}

/* Hero · H2 split diptych, 7/5 --------------------------------------------
 * The right column is a proof column rather than a product shot. There are no
 * real screenshots to use, and a hand-drawn fake of an interface that already
 * exists is worse than none. What it carries instead is the only proof this
 * product can honestly offer today: an exact count of what runs, and an exact
 * count of what doesn't — both read from the same list the app itself shows
 * staff, so the two can never disagree.
 * ------------------------------------------------------------------------ */

function Hero() {
  return (
    // Bottom padding runs heavier than top on purpose. Symmetric padding makes
    // a hero float free of the page; weighting the foot pulls it into the
    // first stage's rhythm, so the eye carries down instead of stopping.
    <section
      className={`${SHELL} pb-[var(--space-3xl)] pt-[var(--space-xl)] md:pb-[calc(var(--space-3xl)*1.5)] md:pt-[var(--space-2xl)]`}
    >
      <div className="grid gap-[var(--space-xl)] lg:grid-cols-12 lg:items-start lg:gap-[var(--space-2xl)]">
        <div className="lg:col-span-7">
          <h1 className="max-w-[16ch] font-display text-[length:var(--text-hero)] font-medium leading-[1.05] tracking-tight">
            Run every branch from one place.
          </h1>

          <p className="mt-[var(--space-lg)] max-w-[54ch] text-base leading-relaxed text-muted-foreground md:text-lg">
            Appointments, clients, stock and reporting for beauty salons in Qatar. One brand, every
            location, four role levels — and a public booking page your clients can use tonight.
          </p>

          <div className="mt-[var(--space-xl)] flex flex-wrap items-center gap-[var(--space-sm)]">
            <Link to="/auth" search={{ mode: "signup" }} className={BUTTON_PRIMARY}>
              Request access
              <ArrowRight aria-hidden="true" className="h-4 w-4" />
            </Link>
            <a href="#inside" className={BUTTON_QUIET}>
              See what runs today
            </a>
          </div>

          <p className="mt-[var(--space-md)] text-sm text-muted-foreground">
            No card required — v1 is invoiced by hand.
          </p>
        </div>

        {/* Hairline divider on wide screens; on narrow it becomes a top border
            on the proof column itself, so the two never double up. */}
        <div className="lg:col-span-5 lg:border-l lg:border-border lg:pl-[var(--space-xl)]">
          <dl className="divide-y divide-border border-y border-border">
            <ProofRow
              figure={String(LIVE.length)}
              label="capabilities working today"
              detail="Booking, deposits, clients, stock, gift cards, packages, reports."
            />
            <ProofRow
              figure={String(UPCOMING.length)}
              label="built, not yet switched on"
              detail="Named in full below. We would rather you knew now than found out later."
            />
            <ProofRow
              figure="QAR"
              label="throughout, not converted"
              detail="Client and service names accept Arabic beside the English interface."
            />
          </dl>
        </div>
      </div>
    </section>
  );
}

function ProofRow({ figure, label, detail }: { figure: string; label: string; detail: string }) {
  return (
    <div className="py-[var(--space-md)]">
      <dt className="flex items-baseline gap-[var(--space-sm)]">
        {/* No `.tnum` here, deliberately. Tabular figures are for columns of
            numbers compared against each other; these three are unrelated and
            stacked, and Cormorant's tabular advance opens a visible gap inside
            "12" when nothing needs to line up with it.
            `overflow-wrap: anywhere` is set globally on display type — correct
            for headings, wrong for a figure, which must never split. */}
        <span className="shrink-0 font-display text-[length:var(--text-display)] font-medium leading-none [overflow-wrap:normal]">
          {figure}
        </span>
        <span className="min-w-0 text-sm text-muted-foreground">{label}</span>
      </dt>
      <dd className="mt-[var(--space-xs)] text-sm leading-relaxed text-muted-foreground">
        {detail}
      </dd>
    </div>
  );
}

/* Stages · F4 step sequence ------------------------------------------------
 * The numerals sit directly above their heading in the same column. The
 * tag-left / heading-right two-column arrangement is the single most
 * recognisable templated-editorial pattern and is banned outright — this is
 * one of the few places a numeral is legitimate, because the stages really
 * are ordinal.
 * ------------------------------------------------------------------------ */

const STAGES = [
  {
    n: "01",
    title: "Set it up once",
    body: "Add your locations, your service list and your team. A service can carry a different price at a different branch, and only an Owner can set that. Everyone else gets one of four fixed roles — Manager, Receptionist or Technician — and sees only what that role needs.",
  },
  {
    n: "02",
    title: "Take the booking",
    body: "Clients book themselves on your own page: phone-verified, showing live availability worked out from real staff rotas and approved leave. Or your receptionist enters it at the desk. Either way the database itself refuses an overlap, so the same chair cannot be sold twice.",
  },
  {
    n: "03",
    title: "Run the day",
    body: "Where you require a deposit, it is taken before the slot is held. Completing a service deducts the products it used from that branch's stock. If the client holds a gift card or a prepaid package, checkout spots it and offers to use it.",
  },
  {
    n: "04",
    title: "See what it made",
    body: "Revenue, stock movement and staff performance — each scoped to who is allowed to see it. A technician sees their own day. A manager sees their branch. You see the whole brand.",
  },
];

function Stages() {
  return (
    <section
      id="inside"
      aria-labelledby="stages-heading"
      className="scroll-mt-[var(--space-lg)] border-t border-border bg-secondary/40"
    >
      <div className={`${SHELL} py-[var(--space-2xl)] md:py-[var(--space-3xl)]`}>
        <h2
          id="stages-heading"
          className="max-w-[22ch] font-display text-[length:var(--text-display)] font-medium tracking-tight"
        >
          What a week looks like once it is in.
        </h2>

        <ol className="mt-[var(--space-xl)] space-y-0">
          {STAGES.map((s, i) => (
            <li
              key={s.n}
              className={`grid gap-[var(--space-sm)] py-[var(--space-lg)] md:grid-cols-12 md:gap-[var(--space-xl)] ${
                i > 0 ? "border-t border-border" : ""
              }`}
            >
              <div className="md:col-span-5">
                <span className="block font-display text-[length:var(--text-display-s)] font-medium leading-none text-muted-foreground [overflow-wrap:normal]">
                  {s.n}
                </span>
                <h3 className="mt-[var(--space-xs)] font-display text-[length:var(--text-display-s)] font-medium tracking-tight">
                  {s.title}
                </h3>
              </div>
              <p className="max-w-[62ch] text-sm leading-relaxed text-muted-foreground md:col-span-7 md:text-base">
                {s.body}
              </p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

/* Spec sheet · F3 ----------------------------------------------------------
 * No logo wall and no testimonials, because there are no customers to name
 * yet and inventing them is the fastest way to lose a buyer who checks. What
 * stands in their place is a list of things that are simply checkable.
 * ------------------------------------------------------------------------ */

const FACTS: { key: string; value: string; note: string }[] = [
  {
    key: "Currency",
    value: "QAR throughout",
    note: "Formatted for Qatar, not converted from a dollar figure.",
  },
  {
    key: "The week",
    value: "Starts Sunday",
    note: "Pinned explicitly, so a weekly revenue figure matches your working week.",
  },
  {
    key: "Language",
    value: "English interface",
    note: "Client and service fields render Arabic correctly beside it.",
  },
  {
    key: "Double-booking",
    value: "Refused by the database",
    note: "Not merely hidden in the interface, where a second tab could get past it.",
  },
  {
    key: "Roles",
    value: "Four, fixed",
    note: "Owner, Manager, Receptionist, Technician. Not a permissions builder to configure.",
  },
  {
    key: "Separation",
    value: "Enforced per row",
    note: "One salon's data is walled off from another's in the database, not in app code.",
  },
  {
    key: "Hosting",
    value: "Mumbai region",
    note: "Not inside Qatar — worth raising early if you have a residency requirement.",
  },
  {
    key: "Billing",
    value: "Invoiced by hand in v1",
    note: "No card on file, no automatic renewal. Card payments are being built.",
  },
];

function SpecSheet() {
  return (
    <section
      aria-labelledby="facts-heading"
      className={`${SHELL} py-[var(--space-2xl)] md:py-[var(--space-3xl)]`}
    >
      <h2
        id="facts-heading"
        className="max-w-[24ch] font-display text-[length:var(--text-display)] font-medium tracking-tight"
      >
        Things you can check before you commit.
      </h2>

      <dl className="mt-[var(--space-xl)] divide-y divide-border border-y border-border">
        {FACTS.map((f) => (
          <div
            key={f.key}
            className="grid gap-1 py-[var(--space-md)] md:grid-cols-12 md:items-baseline md:gap-[var(--space-md)]"
          >
            <dt className="text-sm text-muted-foreground md:col-span-3">{f.key}</dt>
            <dd className="text-sm font-medium md:col-span-4">{f.value}</dd>
            <dd className="text-sm leading-relaxed text-muted-foreground md:col-span-5">
              {f.note}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

/* The honest gap ----------------------------------------------------------
 * A sales page that names its own gaps is unusual. It is also the strongest
 * signal available to a product with no customer list yet: the shipped column
 * reads as a fact rather than a wish list precisely because this column
 * exists beside it. Both are rendered from one shared source, and the visual
 * languages are deliberately different — solid rule and a tick for what runs,
 * dashed rule and a clock for what does not — so no one skimming can mistake
 * one for the other.
 * ------------------------------------------------------------------------ */

function NotYetOn() {
  return (
    <section aria-labelledby="inventory-heading" className="border-t border-border bg-secondary/40">
      <div className={`${SHELL} py-[var(--space-2xl)] md:py-[var(--space-3xl)]`}>
        <h2
          id="inventory-heading"
          className="max-w-[24ch] font-display text-[length:var(--text-display)] font-medium tracking-tight"
        >
          Everything in it, and everything not in it yet.
        </h2>

        <div className="mt-[var(--space-xl)] grid gap-[var(--space-xl)] lg:grid-cols-12 lg:gap-[var(--space-2xl)]">
          <div className="lg:col-span-7">
            <div className="flex items-baseline gap-[var(--space-sm)]">
              <h3 className="font-display text-[length:var(--text-display-s)] font-medium">
                Working today
              </h3>
              <span className="tnum text-sm text-muted-foreground">{LIVE.length}</span>
            </div>
            <ul className="mt-[var(--space-md)] grid gap-px overflow-hidden rounded-[var(--radius)] border border-border bg-border sm:grid-cols-2">
              {LIVE.map((c) => (
                <li
                  key={c.title}
                  className="flex items-start gap-[var(--space-xs)] bg-card p-[var(--space-sm)]"
                >
                  <Check
                    aria-hidden="true"
                    className="mt-0.5 h-4 w-4 shrink-0 text-[var(--color-status-live)]"
                  />
                  <span className="min-w-0 text-sm leading-snug">{c.title}</span>
                </li>
              ))}
            </ul>
          </div>

          <div className="lg:col-span-5">
            <div className="flex items-baseline gap-[var(--space-sm)]">
              <h3 className="font-display text-[length:var(--text-display-s)] font-medium text-muted-foreground">
                Built, not yet switched on
              </h3>
              <span className="tnum text-sm text-muted-foreground">{UPCOMING.length}</span>
            </div>
            <p className="mt-[var(--space-xs)] max-w-[52ch] text-sm text-muted-foreground">
              These exist in the product and are not running. Do not budget for them yet.
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
                      <h4 className="font-display text-base font-medium leading-snug text-muted-foreground">
                        {c.title}
                      </h4>
                      <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                        {c.detail}
                      </p>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </section>
  );
}

/* Plans -------------------------------------------------------------------
 * Every figure here is read from `@/lib/plan-limits`, which is the same
 * module the platform admin tool writes onto a brand and the same numbers the
 * database enforces with a trigger. The page that used to sit here quoted
 * five and twenty staff seats against real limits of three and ten, so an
 * owner would have hit a wall two seats early on the plan they were sold.
 * A marketing page must not hold its own copy of a number the product
 * enforces.
 * ------------------------------------------------------------------------ */

const TIERS: PlanTier[] = ["starter", "growth", "enterprise"];

const UNLIMITED = 999;

function planScope(tier: PlanTier) {
  const { locations, staff } = PLAN_LIMITS[tier];
  const loc =
    locations >= UNLIMITED
      ? "Unlimited locations"
      : `${locations} ${locations === 1 ? "location" : "locations"}`;
  const seats = staff >= UNLIMITED ? "unlimited staff" : `${staff} staff accounts`;
  return `${loc} · ${seats}`;
}

function Plans() {
  return (
    <section
      id="plans"
      aria-labelledby="plans-heading"
      className={`${SHELL} scroll-mt-[var(--space-lg)] py-[var(--space-2xl)] md:py-[var(--space-3xl)]`}
    >
      <h2
        id="plans-heading"
        className="max-w-[20ch] font-display text-[length:var(--text-display)] font-medium tracking-tight"
      >
        Three plans, by how many chairs you run.
      </h2>
      <p className="mt-[var(--space-sm)] max-w-[60ch] text-sm leading-relaxed text-muted-foreground">
        Staff accounts are counted apart from your own Owner login, and the limits are enforced by
        the database — so a plan cannot quietly be exceeded. Invoiced by hand in QAR while v1
        settles; no card is stored.
      </p>

      <div className="mt-[var(--space-xl)] grid gap-px overflow-hidden rounded-[var(--radius)] border border-border bg-border md:grid-cols-3">
        {TIERS.map((tier) => {
          const plan = PLAN_LIMITS[tier];
          const priced = !/contact|custom/i.test(plan.priceMonthly);
          return (
            <div key={tier} className="flex flex-col bg-card p-[var(--space-lg)]">
              <h3 className="font-display text-[length:var(--text-display-s)] font-medium">
                {plan.label}
              </h3>
              <p className="mt-[var(--space-2xs)] text-sm text-muted-foreground">
                {planScope(tier)}
              </p>

              <p className="mt-[var(--space-md)] flex items-baseline gap-[var(--space-2xs)]">
                <span className="tnum font-display text-[length:var(--text-display)] font-medium leading-none [overflow-wrap:normal]">
                  {priced ? `QAR ${plan.priceMonthly}` : plan.priceMonthly}
                </span>
                {priced && <span className="text-sm text-muted-foreground">/month</span>}
              </p>

              <ul className="mt-[var(--space-lg)] flex-1 space-y-[var(--space-sm)]">
                {PLAN_FEATURES[tier].map((f) => (
                  <li key={f} className="flex items-start gap-[var(--space-xs)]">
                    <Check
                      aria-hidden="true"
                      className="mt-0.5 h-4 w-4 shrink-0 text-[var(--color-status-live)]"
                    />
                    <span className="min-w-0 text-sm leading-snug">{f}</span>
                  </li>
                ))}
              </ul>

              <Link
                to="/auth"
                search={{ mode: "signup" }}
                className={`mt-[var(--space-lg)] ${BUTTON_QUIET}`}
              >
                Start on {plan.label}
              </Link>
            </div>
          );
        })}
      </div>
    </section>
  );
}

/* Closing CTA · one button, deliberately ---------------------------------- */

function ClosingCta() {
  return (
    <section className="border-t border-border bg-secondary/40">
      <div
        className={`${SHELL} flex flex-col items-start gap-[var(--space-lg)] py-[var(--space-2xl)] md:flex-row md:items-center md:justify-between`}
      >
        <p className="max-w-[42ch] font-display text-[length:var(--text-display-s)] font-medium tracking-tight">
          Bring one branch across first. The rest can follow when it has earned it.
        </p>
        <Link to="/auth" search={{ mode: "signup" }} className={`shrink-0 ${BUTTON_PRIMARY}`}>
          Request access
          <ArrowRight aria-hidden="true" className="h-4 w-4" />
        </Link>
      </div>
    </section>
  );
}

/* Footer · Ft1 mast-headed ------------------------------------------------
 * One band: wordmark, a line of what it is, two quiet links. The app's own
 * pages keep the tighter Ft2 inline rule; a public page carries slightly more
 * because a visitor arriving cold has somewhere to go next. Not four columns
 * of links to pages that do not exist.
 * ------------------------------------------------------------------------ */

function SiteFooter() {
  return (
    <footer className="border-t border-border">
      <div className={`${SHELL} py-[var(--space-xl)]`}>
        <Wordmark size={26} />
        <p className="mt-[var(--space-sm)] max-w-[46ch] text-sm text-muted-foreground">
          Salon management for Qatar — built in Doha, priced in riyals.
        </p>

        <div className="mt-[var(--space-lg)] flex flex-wrap items-center gap-x-[var(--space-lg)] gap-y-[var(--space-xs)] border-t border-border pt-[var(--space-md)]">
          <Link to="/auth" className={LINK_QUIET}>
            Sign in
          </Link>
          <a href="#plans" className={LINK_QUIET}>
            Plans
          </a>
          <span className="ms-auto text-xs text-muted-foreground">
            © {new Date().getFullYear()} Q-Salon Suite
          </span>
        </div>
      </div>
    </footer>
  );
}
