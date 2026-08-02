import { Link, useNavigate } from "@tanstack/react-router";
import type { ReactNode } from "react";
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
    { label: "Stock", to: "/app/stock", icon: Package },
    { label: "Staff", to: "/app/staff", icon: Users },
    { label: "Reports", to: "/app/reports", icon: TrendingUp },
  ],
  receptionist: [
    { label: "Appointments", to: "/app/appointments", icon: CalendarClock },
    { label: "Clients", to: "/app/clients", icon: Users },
    { label: "Gift cards", to: "/app/gift-cards", icon: Gift },
    { label: "Stock", to: "/app/stock", icon: Package },
  ],
  staff: [
    { label: "My appointments", to: "/app/appointments", icon: CalendarClock },
  ],
};

export function AppShell({ children }: { children: ReactNode }) {
  const tenant = useTenant();
  const navigate = useNavigate();

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

  return (
    <div className="flex min-h-screen bg-background">
      <aside className="hidden w-64 shrink-0 flex-col border-r border-sidebar-border bg-sidebar p-4 md:flex">
        <Link to="/app" className="mb-8 flex items-center gap-2.5 px-2">
          <Logo size={32} className="rounded-md bg-white p-0.5 shadow-sm" />
          <span className="font-display text-base font-semibold tracking-tight text-sidebar-foreground">
            Q-Salon Suite
          </span>
        </Link>
        <nav className="flex-1 space-y-1">
          {nav.map((item) => (
            <Link
              key={item.label}
              to={item.to}
              activeOptions={{ exact: item.to === "/app" }}
              className="flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium text-sidebar-foreground/80 transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
              activeProps={{
                className:
                  "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium bg-sidebar-accent text-sidebar-accent-foreground",
              }}
            >
              <item.icon className="h-4 w-4" />
              {item.label}
            </Link>
          ))}
        </nav>
        <div className="border-t border-sidebar-border pt-3">
          <div className="mb-2 px-3">
            <div className="truncate text-sm font-medium text-sidebar-foreground">
              {tenant.data.fullName ?? tenant.data.email}
            </div>
            <div className="text-xs capitalize text-sidebar-foreground/60">{role}</div>
          </div>
          <button
            onClick={handleSignOut}
            className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm text-sidebar-foreground/80 hover:bg-sidebar-accent"
          >
            <LogOut className="h-4 w-4" /> Sign out
          </button>
        </div>
      </aside>

      <main className="flex-1 overflow-x-hidden">{children}</main>
    </div>
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
        <Link to="/app" className="flex items-center gap-2.5">
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
