import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Logo } from "@/components/logo";
import { ArrowRight, ShieldCheck, Bell, Smile, X, Play, Video, MessageCircle } from "lucide-react";

export const Route = createFileRoute("/")({
  component: Landing,
});

function Landing() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <Nav />
      <Hero />
      <FeatureCards />
      <footer className="border-t border-border">
        <div className="mx-auto max-w-6xl px-6 py-8 text-sm text-muted-foreground md:px-12">
          © {new Date().getFullYear()} Q-Salon Suite. Made for Qatar.
        </div>
      </footer>
    </div>
  );
}

function Nav() {
  return (
    <header className="h-20 w-full bg-background">
      <div className="mx-auto flex h-full max-w-[1280px] items-center justify-between px-6 md:px-12">
        <Link to="/" className="flex items-center gap-2">
          <Logo size={36} />
          <span className="font-display text-2xl font-bold tracking-tight">Q-Salon Suite</span>
        </Link>

        <nav className="hidden items-center gap-10 md:flex">
          {["How it works", "Features", "Pricing", "Docs"].map((l) => (
            <a
              key={l}
              href="#"
              className="text-base font-medium text-muted-foreground transition-colors hover:text-foreground"
            >
              {l}
            </a>
          ))}
        </nav>

        <div className="flex items-center gap-3">
          <Link to="/auth">
            <button className="hidden px-4 py-2 text-base font-medium text-muted-foreground transition-colors hover:text-foreground sm:block">
              Sign in
            </button>
          </Link>
          <Link to="/auth" search={{ mode: "signup" }}>
            <button className="inline-flex h-11 items-center justify-center rounded-full bg-foreground px-6 text-base font-medium text-background transition-opacity hover:opacity-90">
              Sign up
            </button>
          </Link>
        </div>
      </div>
    </header>
  );
}

function Hero() {
  const [email, setEmail] = useState("");
  return (
    <section className="relative px-6 pb-16 pt-16 md:px-12 md:pt-20">
      <div className="mx-auto max-w-[1000px] text-center">
        <h1 className="mx-auto max-w-[900px] font-display text-5xl font-semibold leading-[1.05] tracking-[-0.02em] text-foreground md:text-[72px]">
          Run every branch of your salon
          <span className="text-accent"> with one calm workspace.</span>
        </h1>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            window.location.href = `/auth?mode=signup${email ? `&email=${encodeURIComponent(email)}` : ""}`;
          }}
          className="mx-auto mt-10 flex max-w-md flex-col items-stretch justify-center gap-3 sm:max-w-none sm:flex-row sm:items-center"
        >
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="Enter your work email"
            className="h-[52px] w-full rounded-lg border border-border bg-card px-4 text-base text-foreground placeholder:text-muted-foreground focus:border-foreground focus:outline-none sm:w-[280px]"
          />
          <button
            type="submit"
            className="inline-flex h-[52px] items-center justify-center gap-2 rounded-lg bg-foreground px-6 text-base font-medium text-background transition-opacity hover:opacity-90"
          >
            Start free trial
            <ArrowRight className="h-4 w-4" />
          </button>
        </form>

        <div className="mt-4 flex items-center justify-center gap-2 text-sm text-muted-foreground">
          <ShieldCheck className="h-5 w-5" />
          Role-based access and RLS security at every layer
        </div>
      </div>

      {/* Handwritten decorations — desktop only */}
      <div
        className="pointer-events-none absolute hidden lg:block"
        style={{ left: "8%", top: "58%", transform: "rotate(-6deg)" }}
      >
        <span className="font-handwritten text-lg text-muted-foreground/70">Appointment booking</span>
        <svg width="80" height="40" viewBox="0 0 80 40" className="mt-1 text-muted-foreground/50">
          <path d="M5 5 Q 40 5 70 35" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" />
          <path d="M62 30 L 70 35 L 65 28" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" />
        </svg>
      </div>
      <div
        className="pointer-events-none absolute hidden lg:block"
        style={{ right: "8%", top: "56%", transform: "rotate(5deg)" }}
      >
        <span className="font-handwritten text-lg text-muted-foreground/70">Stock & staff</span>
        <svg width="80" height="40" viewBox="0 0 80 40" className="mt-1 text-muted-foreground/50">
          <path d="M75 5 Q 40 5 10 35" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" />
          <path d="M18 30 L 10 35 L 15 28" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" />
        </svg>
      </div>
    </section>
  );
}

function FeatureCards() {
  return (
    <section className="mx-auto max-w-[1140px] px-6 pb-24 md:px-12">
      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-[1fr_1fr_1.2fr]">
        {/* Column 1 */}
        <div className="flex flex-col gap-4">
          <AppointmentCard />
          <ShortcutsCard />
        </div>

        {/* Column 2 */}
        <ProductivityCard />

        {/* Column 3 */}
        <IntegrationShowcase />
      </div>
    </section>
  );
}

function AppointmentCard() {
  return (
    <div className="rounded-2xl bg-card p-5 shadow-[0_4px_24px_rgba(0,0,0,0.08)]">
      <div className="mb-4 flex items-center justify-between">
        <span className="text-base font-medium text-muted-foreground">Appointment</span>
        <X className="h-5 w-5 text-muted-foreground" />
      </div>
      <div className="mb-3 flex items-center gap-2">
        <div className="grid h-5 w-5 place-items-center rounded-full bg-accent/15">
          <Video className="h-3 w-3 text-accent" />
        </div>
        <span className="text-sm text-muted-foreground">Al Sadd · Chair 3</span>
      </div>
      <div className="font-display text-[28px] font-semibold leading-tight text-foreground">
        Monday, 8 Mar
      </div>
      <div className="mt-1 text-sm text-muted-foreground">10:00 – 11:15 AM</div>

      <div className="my-3 h-px bg-border" />

      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        Booked by:
        <span className="inline-flex items-center gap-1 font-medium text-foreground">
          <MessageCircle className="h-4 w-4" />
          Reception
        </span>
      </div>

      <div className="mt-5 flex items-center justify-between">
        <button className="rounded-lg bg-secondary px-5 py-2.5 text-sm font-medium text-secondary-foreground">
          Confirm
        </button>
        <div className="flex gap-3">
          <Bell className="h-5 w-5 text-muted-foreground" />
          <Smile className="h-5 w-5 text-muted-foreground" />
        </div>
      </div>
    </div>
  );
}

function ShortcutsCard() {
  return (
    <div className="flex items-center justify-between gap-4 rounded-2xl bg-card p-6 shadow-[0_4px_24px_rgba(0,0,0,0.08)]">
      <div>
        <div className="font-display text-2xl font-semibold text-foreground">Shortcuts</div>
        <div className="mt-1 text-sm text-muted-foreground">Jump to what you need</div>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <Key>⌘</Key>
        <Key>K</Key>
        <button className="grid h-12 w-12 place-items-center rounded-lg bg-foreground">
          <Play className="h-4 w-4 fill-background text-background" />
        </button>
      </div>
    </div>
  );
}

function Key({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid h-12 w-12 place-items-center rounded-lg border border-border bg-muted text-lg text-foreground">
      {children}
    </div>
  );
}

function ProductivityCard() {
  return (
    <div className="flex min-h-[280px] flex-col justify-between rounded-2xl bg-card p-8 shadow-[0_4px_24px_rgba(0,0,0,0.08)]">
      <div className="flex items-center gap-2">
        <span className="font-display text-[96px] font-bold leading-none text-foreground">3X</span>
        <div className="flex">
          {[1, 0.6, 0.3].map((op, i) => (
            <svg key={i} width="24" height="56" viewBox="0 0 24 56" style={{ opacity: op }} className="text-primary">
              <path
                d="M6 8 L18 28 L6 48"
                stroke="currentColor"
                strokeWidth="4"
                fill="none"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          ))}
        </div>
      </div>
      <p className="mt-6 max-w-[220px] text-base leading-relaxed text-muted-foreground">
        Triple your front-desk speed with one workspace for every branch.
      </p>
    </div>
  );
}

function IntegrationShowcase() {
  return (
    <div className="relative min-h-[360px] w-full">
      {/* Mint layer */}
      <div
        className="absolute right-2 top-0 w-[200px] rounded-xl p-4 shadow-[0_4px_16px_rgba(0,0,0,0.08)]"
        style={{ background: "#A7F3D0" }}
      >
        <div className="mb-3 text-xs font-semibold text-foreground/70">Today · Al Sadd</div>
        {[80, 60, 70].map((w, i) => (
          <div key={i} className="mb-2 h-2 rounded" style={{ width: `${w}%`, background: "rgba(0,0,0,0.12)" }} />
        ))}
      </div>

      {/* Yellow layer */}
      <div
        className="absolute right-16 top-10 w-[180px] rotate-[3deg] rounded-xl p-4 shadow-[0_4px_16px_rgba(0,0,0,0.08)]"
        style={{ background: "#FEF3C7" }}
      >
        <div className="mb-3 text-xs font-semibold text-foreground/70">Stock alerts</div>
        {[70, 50, 65].map((w, i) => (
          <div key={i} className="mb-2 h-2 rounded" style={{ width: `${w}%`, background: "rgba(0,0,0,0.12)" }} />
        ))}
      </div>

      {/* Peach layer */}
      <div
        className="absolute bottom-4 left-2 w-[170px] -rotate-[5deg] rounded-xl p-4 shadow-[0_4px_16px_rgba(0,0,0,0.08)]"
        style={{ background: "#FED7AA" }}
      >
        <div className="mb-3 text-xs font-semibold text-foreground/70">Revenue · This week</div>
        {[85, 55, 40].map((w, i) => (
          <div key={i} className="mb-2 h-2 rounded" style={{ width: `${w}%`, background: "rgba(0,0,0,0.15)" }} />
        ))}
      </div>

      {/* Foreground Notion-style task card */}
      <div className="absolute left-16 top-16 z-10 w-[260px] rounded-xl bg-card p-5 shadow-[0_8px_32px_rgba(0,0,0,0.12)]">
        <div className="mb-3 flex items-center gap-2">
          <Logo size={20} />
          <span className="text-sm font-medium text-foreground">Q-Salon</span>
        </div>
        <div className="mb-2 text-xs text-muted-foreground">Appointment booked:</div>
        <div className="mb-4 text-base font-semibold leading-snug text-foreground">
          Balayage & blow-dry for Fatima A.
        </div>
        <div className="text-sm font-medium text-foreground">Tuesday, 14 Mar</div>
        <div className="mt-1 flex items-center gap-2 text-sm text-muted-foreground">
          9:23 AM
          <span className="text-border">|</span>
          Noura + Layla
        </div>
      </div>
    </div>
  );
}
