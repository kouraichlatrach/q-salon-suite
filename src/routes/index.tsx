import { createFileRoute, Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { CalendarClock, Users, Package, TrendingUp, MapPin, ShieldCheck } from "lucide-react";

export const Route = createFileRoute("/")({
  component: Landing,
});

function Landing() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Nav */}
      <header className="border-b border-border/60 bg-background/80 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <Link to="/" className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-md bg-primary text-primary-foreground font-display font-semibold">
              L
            </div>
            <span className="font-display text-lg font-semibold tracking-tight">Q-Salon Suite</span>
          </Link>
          <nav className="flex items-center gap-2">
            <Link to="/auth">
              <Button variant="ghost" size="sm">Sign in</Button>
            </Link>
            <Link to="/auth" search={{ mode: "signup" }}>
              <Button size="sm">Get started</Button>
            </Link>
          </nav>
        </div>
      </header>

      {/* Hero */}
      <section className="mx-auto max-w-6xl px-6 pb-16 pt-20 md:pt-28">
        <div className="grid gap-12 md:grid-cols-2 md:items-center">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-border bg-secondary px-3 py-1 text-xs font-medium text-secondary-foreground">
              <span className="h-1.5 w-1.5 rounded-full bg-accent" />
              Purpose-built for Qatar salon chains
            </div>
            <h1 className="mt-6 font-display text-5xl font-semibold leading-tight tracking-tight md:text-6xl">
              Run every branch of your salon <span className="text-accent">with one calm workspace.</span>
            </h1>
            <p className="mt-5 max-w-xl text-lg text-muted-foreground">
              Appointments, staff, stock, clients and income — organised across all your locations, with the right access for every role.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link to="/auth" search={{ mode: "signup" }}>
                <Button size="lg">Start free trial</Button>
              </Link>
              <Link to="/auth">
                <Button size="lg" variant="outline">Sign in</Button>
              </Link>
            </div>
            <p className="mt-4 text-xs text-muted-foreground">
              No card required. Billed offline via bank transfer.
            </p>
          </div>

          <div className="relative">
            <div className="rounded-2xl border border-border bg-card p-6 shadow-lg">
              <div className="mb-4 flex items-center justify-between">
                <div>
                  <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Today · Al Sadd</div>
                  <div className="mt-1 font-display text-xl font-semibold">14 appointments</div>
                </div>
                <div className="rounded-md bg-accent px-2.5 py-1 text-xs font-medium text-accent-foreground">Live</div>
              </div>
              <div className="space-y-2">
                {[
                  { time: "10:00", client: "Fatima A.", svc: "Balayage" },
                  { time: "11:30", client: "Noura M.", svc: "Manicure Deluxe" },
                  { time: "13:00", client: "Layla H.", svc: "Bridal Package" },
                ].map((r) => (
                  <div
                    key={r.time}
                    className="flex items-center justify-between rounded-lg bg-secondary px-4 py-3"
                  >
                    <div className="flex items-center gap-3">
                      <div className="font-mono text-sm font-medium text-muted-foreground">{r.time}</div>
                      <div>
                        <div className="text-sm font-medium">{r.client}</div>
                        <div className="text-xs text-muted-foreground">{r.svc}</div>
                      </div>
                    </div>
                    <div className="h-2 w-2 rounded-full bg-success" />
                  </div>
                ))}
              </div>
              <div className="mt-5 grid grid-cols-3 gap-3 border-t border-border pt-4 text-center">
                <div>
                  <div className="font-display text-2xl font-semibold">QAR 4,820</div>
                  <div className="text-xs text-muted-foreground">Today</div>
                </div>
                <div>
                  <div className="font-display text-2xl font-semibold">92%</div>
                  <div className="text-xs text-muted-foreground">Show rate</div>
                </div>
                <div>
                  <div className="font-display text-2xl font-semibold">6</div>
                  <div className="text-xs text-muted-foreground">Stylists on</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Feature grid */}
      <section className="border-t border-border bg-secondary/40">
        <div className="mx-auto max-w-6xl px-6 py-20">
          <h2 className="max-w-2xl font-display text-3xl font-semibold tracking-tight md:text-4xl">
            Everything a modern salon brand needs — nothing it doesn't.
          </h2>
          <div className="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {[
              { icon: CalendarClock, title: "Appointments", body: "Full calendar with conflict prevention, staff schedules and leave." },
              { icon: Users, title: "Client profiles", body: "Shared brand-wide history, allergies, no-show flags and treatment records." },
              { icon: Package, title: "Inventory", body: "Per-location stock with restock, usage and low-stock alerts." },
              { icon: TrendingUp, title: "Revenue reports", body: "Track income by day, week, staff, service or location." },
              { icon: MapPin, title: "Multi-location", body: "One brand, many branches — pricing overrides where you need them." },
              { icon: ShieldCheck, title: "Role-based access", body: "Owner, Manager, Receptionist and Staff — each sees only what they should." },
            ].map((f) => (
              <div key={f.title} className="rounded-xl border border-border bg-card p-6">
                <div className="flex h-10 w-10 items-center justify-center rounded-md bg-accent/15 text-accent">
                  <f.icon className="h-5 w-5" />
                </div>
                <h3 className="mt-4 font-display text-lg font-semibold">{f.title}</h3>
                <p className="mt-2 text-sm text-muted-foreground">{f.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <footer className="border-t border-border">
        <div className="mx-auto max-w-6xl px-6 py-8 text-sm text-muted-foreground">
          © {new Date().getFullYear()} Q-Salon Suite. Made for Qatar.
        </div>
      </footer>
    </div>
  );
}
