import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { useEffect, useState, type ReactNode } from "react";
import {
  CalendarClock,
  Users,
  Package,
  TrendingUp,
  MapPin,
  Settings,
  LogOut,
  Sparkles,
  ShieldCheck,
  Inbox,
  Gift,
  Boxes,
  Menu,
  X,
} from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { useTenant, type AppRole } from "@/hooks/use-tenant";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Logo } from "@/components/logo";

type NavItem = { label: string; to: string; icon: typeof CalendarClock };

const NAV_BY_ROLE: Record<AppRole, NavItem[]> = {
  owner: [
    { label: "Overview", to: "/app", icon: TrendingUp },
    { label: "Appointments", to: "/app/appointments", icon: CalendarClock },
    { label: "Clients", to: "/app/clients", icon: Users },
    { label: "Services", to: "/app/services", icon: Sparkles },
    { label: "Gift cards", to: "/app/gift-cards", icon: Gift },
    { label: "Packages", to: "/app/packages", icon: Boxes },
    { label: "Stock", to: "/app/stock", icon: Package },
    { label: "Locations", to: "/app/locations", icon: MapPin },
    { label: "Staff", to: "/app/staff", icon: Users },
    { label: "Reports", to: "/app/reports", icon: TrendingUp },
    { label: "Settings", to: "/app/settings", icon: Settings },
  ],
  manager: [
    { label: "Overview", to: "/app", icon: TrendingUp },
    { label: "Appointments", to: "/app/appointments", icon: CalendarClock },
    { label: "Clients", to: "/app/clients", icon: Users },
    { label: "Services", to: "/app/services", icon: Sparkles },
    { label: "Gift cards", to: "/app/gift-cards", icon: Gift },
    { label: "Packages", to: "/app/packages", icon: Boxes },
    { label: "Stock", to: "/app/stock", icon: Package },
    { label: "Staff", to: "/app/staff", icon: Users },
    { label: "Reports", to: "/app/reports", icon: TrendingUp },
  ],
  receptionist: [
    { label: "Appointments", to: "/app/appointments", icon: CalendarClock },
    { label: "Clients", to: "/app/clients", icon: Users },
    { label: "Gift cards", to: "/app/gift-cards", icon: Gift },
    { label: "Packages", to: "/app/packages", icon: Boxes },
    { label: "Stock", to: "/app/stock", icon: Package },
  ],
  staff: [
    { label: "My appointments", to: "/app/appointments", icon: CalendarClock },
  ],
};

export function AppShell({ children }: { children: ReactNode }) {
  const tenant = useTenant();
  const navigate = useNavigate();

  // The sidebar was `hidden md:flex` with no alternative, so below 768px the
  // app had no navigation at all — every route was a dead end unless you knew
  // the URL. This drawer is that missing half.
  const [menuOpen, setMenuOpen] = useState(false);
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  // Navigating closes the drawer. Without this the panel stays open over the
  // page you just asked for.
  useEffect(() => {
    setMenuOpen(false);
  }, [pathname]);

  // Escape closes it, and the body doesn't scroll behind the overlay.
  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenuOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [menuOpen]);

  async function handleSignOut() {
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  }

  if (tenant.isLoading || !tenant.data) {
    return (
      <div className="min-h-screen bg-background p-8">
        <Skeleton className="mb-4 h-12 w-64" />
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }

  const role = tenant.data.primaryRole;

  // No brand membership — render a friendly state instead of a broken staff nav.
  if (!role) {
    return (
      <NoBrandLanding
        isPlatformAdmin={tenant.data.isPlatformAdmin}
        email={tenant.data.email}
        fullName={tenant.data.fullName}
        onSignOut={handleSignOut}
      />
    );
  }

  const nav = NAV_BY_ROLE[role];

  const identity = tenant.data.fullName ?? tenant.data.email;

  return (
    <div className="flex min-h-screen bg-background">
      {/* Desktop side-rail. */}
      <aside className="hidden w-64 shrink-0 flex-col border-r border-sidebar-border bg-sidebar px-[var(--space-sm)] py-[var(--space-md)] md:flex">
        <RailBody
          nav={nav}
          role={role}
          identity={identity}
          onSignOut={handleSignOut}
        />
      </aside>

      {/* Mobile top bar — the rail has no room below 768px. */}
      <header className="fixed inset-x-0 top-0 z-40 flex h-14 items-center justify-between border-b border-sidebar-border bg-sidebar px-[var(--space-md)] md:hidden">
        <Link
          to="/app"
          className="flex items-center gap-2 rounded-[var(--radius)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-sidebar-ring)]"
        >
          <Logo size={26} className="rounded-[var(--radius-sm)] bg-white p-0.5" />
          <span className="font-display text-sm font-semibold tracking-tight text-sidebar-foreground">
            Q-Salon Suite
          </span>
        </Link>
        <button
          type="button"
          onClick={() => setMenuOpen((v) => !v)}
          aria-expanded={menuOpen}
          aria-controls="app-mobile-nav"
          aria-label={menuOpen ? "Close menu" : "Open menu"}
          className="-mr-1 inline-flex h-10 w-10 items-center justify-center rounded-[var(--radius)] text-sidebar-foreground transition-[color,background-color,border-color] duration-[var(--dur-fast)] ease-[var(--ease-out)] hover:bg-sidebar-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-sidebar-ring)] active:translate-y-px"
        >
          {menuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </button>
      </header>

      {menuOpen && (
        <>
          <button
            type="button"
            aria-hidden="true"
            tabIndex={-1}
            onClick={() => setMenuOpen(false)}
            className="fixed inset-0 z-40 bg-charcoal/40 md:hidden"
          />
          <div
            id="app-mobile-nav"
            className="fixed inset-x-0 bottom-0 top-14 z-40 flex flex-col overflow-y-auto bg-sidebar px-[var(--space-sm)] py-[var(--space-md)] md:hidden"
          >
            <RailBody
              nav={nav}
              role={role}
              identity={identity}
              onSignOut={handleSignOut}
            />
          </div>
        </>
      )}

      {/* Gate 34: clip, not hidden — `hidden` would make this a scroll
          container and break any sticky child inside a page. */}
      <main className="min-w-0 flex-1 overflow-x-clip pt-14 md:pt-0">{children}</main>
    </div>
  );
}

/**
 * Shared by the desktop rail and the mobile drawer so the two can't drift.
 * The active item is marked with a rose-gold edge rather than a filled pill —
 * the accent stays a hairline, well under the 3%-of-viewport budget.
 */
function RailBody({
  nav,
  role,
  identity,
  onSignOut,
}: {
  nav: NavItem[];
  role: AppRole;
  identity: string | null;
  onSignOut: () => void;
}) {
  return (
    <>
      <Link
        to="/app"
        className="mb-[var(--space-lg)] hidden items-center gap-[var(--space-xs)] rounded-[var(--radius)] px-[var(--space-xs)] py-1 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-sidebar-ring)] md:flex"
      >
        <Logo size={30} className="rounded-[var(--radius-sm)] bg-white p-0.5 shadow-sm" />
        <span className="font-display text-base font-semibold tracking-tight text-sidebar-foreground">
          Q-Salon Suite
        </span>
      </Link>

      <nav className="flex-1 space-y-[var(--space-2xs)]">
        {nav.map((item) => (
          <Link
            key={item.label}
            to={item.to}
            activeOptions={{ exact: item.to === "/app" }}
            className="flex items-center gap-[var(--space-sm)] whitespace-nowrap rounded-[var(--radius)] border-l-2 border-transparent px-[var(--space-sm)] py-[var(--space-xs)] text-sm font-medium text-sidebar-foreground/75 transition-[color,background-color,border-color] duration-[var(--dur-fast)] ease-[var(--ease-out)] hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-sidebar-ring)]"
            activeProps={{
              className:
                "flex items-center gap-[var(--space-sm)] whitespace-nowrap rounded-[var(--radius)] border-l-2 border-[var(--color-sidebar-primary)] bg-sidebar-accent px-[var(--space-sm)] py-[var(--space-xs)] text-sm font-medium text-sidebar-accent-foreground",
            }}
          >
            <item.icon aria-hidden="true" className="h-4 w-4 shrink-0" />
            {item.label}
          </Link>
        ))}
      </nav>

      {/* Ft2 · inline rule, single line. Identity and exit, nothing else. */}
      <div className="mt-[var(--space-md)] border-t border-sidebar-border pt-[var(--space-sm)]">
        <div className="px-[var(--space-sm)] pb-[var(--space-xs)]">
          <div className="truncate text-sm font-medium text-sidebar-foreground">
            {identity}
          </div>
          <div className="text-xs capitalize text-sidebar-foreground/55">{role}</div>
        </div>
        <button
          type="button"
          onClick={onSignOut}
          className="flex w-full items-center gap-2 whitespace-nowrap rounded-[var(--radius)] px-[var(--space-sm)] py-2 text-sm text-sidebar-foreground/75 transition-[color,background-color,border-color] duration-[var(--dur-fast)] ease-[var(--ease-out)] hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-sidebar-ring)] active:translate-y-px"
        >
          <LogOut aria-hidden="true" className="h-4 w-4 shrink-0" /> Sign out
        </button>
      </div>
    </>
  );
}

function NoBrandLanding({
  isPlatformAdmin,
  email,
  fullName,
  onSignOut,
}: {
  isPlatformAdmin: boolean;
  email: string | null;
  fullName: string | null;
  onSignOut: () => void;
}) {
  return (
    <div className="min-h-screen bg-background">
      <header className="flex items-center justify-between border-b border-border px-6 py-4">
        <Link to="/app" className="flex items-center gap-[var(--space-xs)]">
          <Logo size={32} />
          <span className="font-display text-base font-semibold tracking-tight">Q-Salon Suite</span>
        </Link>
        <div className="flex items-center gap-3 text-sm">
          <span className="hidden text-muted-foreground sm:inline">
            {fullName ?? email}
          </span>
          <Button variant="ghost" size="sm" onClick={onSignOut}>
            <LogOut className="mr-2 h-4 w-4" /> Sign out
          </Button>
        </div>
      </header>

      <div className="mx-auto max-w-xl px-6 py-16">
        {isPlatformAdmin ? (
          <Card>
            <CardHeader>
              <div className="mb-2 flex h-10 w-10 items-center justify-center rounded-full bg-accent/10 text-accent">
                <ShieldCheck className="h-5 w-5" />
              </div>
              <CardTitle className="font-display text-2xl">Platform admin account</CardTitle>
              <CardDescription>
                This account is a platform admin and isn't part of any salon. Go to the admin
                console to manage subscriptions, or sign up as a salon owner from a different
                account to create one.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-2">
              <Button asChild>
                <Link to="/admin">Open admin console</Link>
              </Button>
              <Button variant="outline" onClick={onSignOut}>
                Sign out
              </Button>
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardHeader>
              <div className="mb-2 flex h-10 w-10 items-center justify-center rounded-full bg-muted text-muted-foreground">
                <Inbox className="h-5 w-5" />
              </div>
              <CardTitle className="font-display text-2xl">
                Your account isn't linked to a salon yet
              </CardTitle>
              <CardDescription>
                If you were invited by an owner, check that the invite used this exact email
                address ({email ?? "your email"}) and ask them to re-send it if needed.
                Otherwise, you can create a new salon of your own.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-2">
              <Button asChild>
                <Link to="/app">Create a salon</Link>
              </Button>
              <Button variant="outline" onClick={onSignOut}>
                Sign out
              </Button>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
