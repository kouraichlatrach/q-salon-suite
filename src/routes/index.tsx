import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { Logo } from "@/components/logo";
import {
  ArrowRight,
  Calendar,
  Users,
  TrendingUp,
  MessageSquare,
  Package,
  Check,
  Sparkles,
} from "lucide-react";

export const Route = createFileRoute("/")({
  component: Landing,
});

function Landing() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <Nav />
      <Hero />
      <BentoGrid />
      <Pricing />
      <SiteFooter />
    </div>
  );
}

/* ---------------------------------- Nav ---------------------------------- */

function Nav() {
  return (
    <header className="w-full">
      <div className="mx-auto flex h-20 max-w-6xl items-center justify-between px-6 md:px-8">
        <Link to="/" className="flex items-center gap-2.5">
          <Logo size={34} />
          <span className="font-display text-2xl font-medium tracking-tight text-foreground">
            Q-Salon <span className="italic text-primary">Suite</span>
          </span>
        </Link>

        <nav className="hidden items-center gap-10 md:flex">
          {["Features", "Pricing", "About"].map((l) => (
            <a
              key={l}
              href={`#${l.toLowerCase()}`}
              className="text-sm font-medium text-foreground/70 transition-colors hover:text-primary"
            >
              {l}
            </a>
          ))}
        </nav>

        <div className="flex items-center gap-2">
          <Link
            to="/auth"
            className="hidden px-4 py-2 text-sm font-medium text-foreground/70 transition-colors hover:text-foreground sm:inline-block"
          >
            Sign in
          </Link>
          <Link
            to="/auth"
            search={{ mode: "signup" }}
            className="inline-flex h-10 items-center justify-center rounded-none bg-primary px-6 text-xs font-semibold uppercase tracking-[0.18em] text-primary-foreground transition-colors hover:bg-rose-gold-deep"
          >
            Request Access
          </Link>
        </div>
      </div>
      <div className="mx-auto h-px max-w-6xl bg-border/60" />
    </header>
  );
}

/* --------------------------------- Hero ---------------------------------- */

function Hero() {
  const [email, setEmail] = useState("");
  return (
    <section className="px-6 pt-20 pb-16 md:px-8 md:pt-28 md:pb-20">
      <div className="mx-auto max-w-3xl space-y-7 text-center">
        <span className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.22em] text-primary">
          <Sparkles className="h-3.5 w-3.5" />
          The New Standard in Qatar Luxury
        </span>

        <h1 className="font-display text-5xl leading-[1.02] tracking-tight text-foreground md:text-[76px]">
          Elevate your salon's
          <br />
          <span className="italic text-primary">digital presence.</span>
        </h1>

        <p className="mx-auto max-w-xl text-lg leading-relaxed text-foreground/70">
          A bespoke CRM suite designed for the prestigious beauty houses of Qatar.
          Elegance meets operational excellence — across every branch, every chair,
          every guest.
        </p>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            window.location.href = `/auth?mode=signup${
              email ? `&email=${encodeURIComponent(email)}` : ""
            }`;
          }}
          className="mx-auto flex max-w-md flex-col items-stretch gap-3 pt-4 sm:max-w-lg sm:flex-row"
        >
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="your@salon.qa"
            dir="auto"
            className="h-12 flex-1 border border-border bg-card px-4 text-sm text-foreground placeholder:text-foreground/40 focus:border-primary focus:outline-none"
          />
          <button
            type="submit"
            className="inline-flex h-12 items-center justify-center gap-2 bg-primary px-7 text-xs font-semibold uppercase tracking-[0.18em] text-primary-foreground transition-all hover:bg-rose-gold-deep hover:shadow-lg"
          >
            Request Access
            <ArrowRight className="h-4 w-4" />
          </button>
        </form>

        <p className="text-xs text-foreground/50">
          Trusted by Doha's premier salons · Arabic &amp; English throughout
        </p>
      </div>
    </section>
  );
}

/* ------------------------------- Bento Grid ------------------------------ */

function BentoGrid() {
  return (
    <section id="features" className="px-6 pb-24 md:px-8">
      <div className="mx-auto max-w-6xl">
        <div className="grid auto-rows-[200px] grid-cols-1 gap-4 md:grid-cols-12">
          {/* Scheduling — hero tile */}
          <div className="flex flex-col justify-between border border-steel bg-sand-deep p-8 md:col-span-8 md:row-span-2">
            <div className="space-y-4">
              <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.22em] text-primary">
                <Calendar className="h-3.5 w-3.5" />
                Appointments
              </div>
              <h3 className="font-display text-4xl font-medium leading-tight text-foreground">
                Seamless Scheduling
              </h3>
              <p className="max-w-sm text-sm leading-relaxed text-foreground/60">
                Manage high-profile bookings with a fluid, intuitive interface designed
                for fast-paced luxury environments — with double-booking prevention at
                the database level.
              </p>
            </div>

            {/* Product surface preview */}
            <div className="mt-8 flex gap-3 overflow-hidden">
              <CalendarSlot time="10:00" name="Fatima Al-Thani" service="Balayage" tone="active" />
              <CalendarSlot time="11:30" name="Sarah Jenkins" service="HydraFacial" />
              <CalendarSlot time="14:00" name="Dana Rashid" service="Silk Press" />
            </div>
          </div>

          {/* Client CRM */}
          <div className="flex flex-col justify-center border border-charcoal bg-charcoal p-8 text-white md:col-span-4 md:row-span-1">
            <div className="mb-3 flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.22em] text-primary">
              <Users className="h-3.5 w-3.5" />
              Clients
            </div>
            <h3 className="mb-2 font-display text-2xl font-medium text-primary">
              Client Archives
            </h3>
            <p className="text-sm text-white/60">
              Private profiles, visit history, and no-show tracking — brand-wide.
            </p>
          </div>

          {/* Revenue */}
          <div className="flex flex-col justify-between bg-primary p-8 text-white md:col-span-4 md:row-span-2">
            <div className="flex items-center justify-between">
              <div className="flex h-11 w-11 items-center justify-center rounded-full border border-white/30">
                <TrendingUp className="h-5 w-5" />
              </div>
              <div className="text-[10px] font-bold uppercase tracking-[0.22em] text-white/60">
                Reports
              </div>
            </div>
            <div>
              <div className="mb-1 font-display text-5xl font-medium leading-none">
                +28.4%
              </div>
              <div className="mb-4 text-xs uppercase tracking-widest text-white/60">
                Revenue vs Q3
              </div>
              <div className="mb-5 flex items-end gap-1.5 h-14">
                {[35, 55, 45, 70, 60, 85, 100].map((h, i) => (
                  <div
                    key={i}
                    className="w-full rounded-sm bg-white/80"
                    style={{ height: `${h}%` }}
                  />
                ))}
              </div>
              <h3 className="font-display text-2xl font-medium">Revenue Insights</h3>
              <p className="mt-1 text-sm text-white/80">
                Visualizing growth with artisanal precision.
              </p>
            </div>
          </div>

          {/* Marketing */}
          <div className="flex items-center border border-steel bg-sand-deep p-8 md:col-span-4 md:row-span-1">
            <div>
              <div className="mb-2 flex items-center gap-2 text-primary">
                <MessageSquare className="h-4 w-4" />
              </div>
              <h3 className="font-display text-xl font-medium text-foreground">
                WhatsApp Reminders
              </h3>
              <p className="mt-0.5 text-[10px] font-bold uppercase tracking-widest text-foreground/50">
                Bespoke Outreach
              </p>
            </div>
          </div>

          {/* Inventory */}
          <div className="flex items-center justify-between border border-steel bg-card p-8 md:col-span-4 md:row-span-1">
            <div className="flex items-center gap-3">
              <Package className="h-5 w-5 text-primary" />
              <h3 className="font-display text-xl font-medium text-foreground">
                Inventory Control
              </h3>
            </div>
            <div className="h-0.5 w-12 bg-primary" />
          </div>
        </div>
      </div>
    </section>
  );
}

function CalendarSlot({
  time,
  name,
  service,
  tone,
}: {
  time: string;
  name: string;
  service: string;
  tone?: "active";
}) {
  const active = tone === "active";
  return (
    <div
      className={`h-32 flex-shrink-0 border p-3 ${
        active
          ? "w-52 border-primary/40 bg-primary/10"
          : "w-48 border-white/40 bg-white/60"
      }`}
    >
      <div
        className={`mb-2 text-[10px] font-bold uppercase tracking-widest ${
          active ? "text-primary" : "text-foreground/40"
        }`}
      >
        {time}
      </div>
      <div className="font-display text-base leading-tight text-foreground">
        {name}
      </div>
      <div className="mt-1 text-xs text-foreground/60">{service}</div>
      <div className={`mt-3 h-0.5 w-8 ${active ? "bg-primary" : "bg-foreground/15"}`} />
    </div>
  );
}

/* --------------------------------- Pricing -------------------------------- */

function Pricing() {
  const tiers = [
    {
      name: "Starter",
      price: "1,200",
      note: "For a single boutique salon",
      features: ["1 location", "Up to 5 staff", "Core CRM & bookings", "Email support"],
    },
    {
      name: "Growth",
      price: "2,800",
      note: "For growing salon chains",
      features: [
        "Up to 3 locations",
        "Up to 20 staff",
        "Stock & reports",
        "WhatsApp reminders",
        "Priority support",
      ],
      featured: true,
    },
    {
      name: "Enterprise",
      price: "Custom",
      note: "For established beauty houses",
      features: [
        "Unlimited locations",
        "Unlimited staff",
        "Custom onboarding",
        "Dedicated success lead",
      ],
    },
  ];

  return (
    <section id="pricing" className="border-t border-border/60 px-6 py-24 md:px-8">
      <div className="mx-auto max-w-6xl">
        <div className="mb-14 max-w-2xl">
          <span className="text-xs font-semibold uppercase tracking-[0.22em] text-primary">
            Pricing
          </span>
          <h2 className="mt-3 font-display text-4xl md:text-5xl">
            Bespoke plans, transparent value.
          </h2>
          <p className="mt-3 text-foreground/60">
            Priced in QAR per month. Manual, offline invoicing in v1 — no card required.
          </p>
        </div>

        <div className="grid gap-4 md:grid-cols-3">
          {tiers.map((t) => (
            <div
              key={t.name}
              className={`flex flex-col border p-8 ${
                t.featured
                  ? "border-primary bg-charcoal text-white"
                  : "border-steel bg-card"
              }`}
            >
              <div
                className={`text-[10px] font-bold uppercase tracking-[0.22em] ${
                  t.featured ? "text-primary" : "text-primary"
                }`}
              >
                {t.name}
              </div>
              <div className="mt-4 flex items-baseline gap-1">
                <span className="font-display text-5xl font-medium">
                  {t.price === "Custom" ? "Custom" : `QAR ${t.price}`}
                </span>
                {t.price !== "Custom" && (
                  <span className={`text-sm ${t.featured ? "text-white/50" : "text-foreground/50"}`}>
                    /mo
                  </span>
                )}
              </div>
              <p className={`mt-2 text-sm ${t.featured ? "text-white/60" : "text-foreground/60"}`}>
                {t.note}
              </p>

              <div
                className={`my-6 h-px ${t.featured ? "bg-white/15" : "bg-border"}`}
              />

              <ul className="space-y-3">
                {t.features.map((f) => (
                  <li key={f} className="flex items-start gap-2.5 text-sm">
                    <Check
                      className={`mt-0.5 h-4 w-4 shrink-0 ${
                        t.featured ? "text-primary" : "text-primary"
                      }`}
                    />
                    <span className={t.featured ? "text-white/85" : "text-foreground/80"}>
                      {f}
                    </span>
                  </li>
                ))}
              </ul>

              <Link
                to="/auth"
                search={{ mode: "signup" }}
                className={`mt-8 inline-flex h-11 items-center justify-center text-xs font-semibold uppercase tracking-[0.18em] transition-colors ${
                  t.featured
                    ? "bg-primary text-primary-foreground hover:bg-rose-gold-deep"
                    : "border border-foreground text-foreground hover:bg-foreground hover:text-background"
                }`}
              >
                Get Started
              </Link>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* --------------------------------- Footer -------------------------------- */

function SiteFooter() {
  return (
    <footer className="border-t border-border/60 bg-sand-deep">
      <div className="mx-auto flex max-w-6xl flex-col items-start justify-between gap-6 px-6 py-10 md:flex-row md:items-center md:px-8">
        <div className="flex items-center gap-2.5">
          <Logo size={28} />
          <span className="font-display text-lg font-medium">
            Q-Salon <span className="italic text-primary">Suite</span>
          </span>
        </div>
        <p className="text-sm text-foreground/60">
          © {new Date().getFullYear()} Q-Salon Suite · Crafted in Doha · صُنع بعناية
        </p>
      </div>
    </footer>
  );
}
