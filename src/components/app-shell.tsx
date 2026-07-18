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
} from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { useTenant, type AppRole } from "@/hooks/use-tenant";

type NavItem = { label: string; to: string; icon: typeof CalendarClock };

const NAV_BY_ROLE: Record<AppRole, NavItem[]> = {
  owner: [
    { label: "Overview", to: "/app", icon: TrendingUp },
    { label: "Appointments", to: "/app/appointments", icon: CalendarClock },
    { label: "Clients", to: "/app/clients", icon: Users },
    { label: "Services", to: "/app/services", icon: Sparkles },
    { label: "Stock", to: "/app/stock", icon: Package },
    { label: "Locations", to: "/app", icon: MapPin },
    { label: "Staff", to: "/app/staff", icon: Users },
    { label: "Reports", to: "/app/reports", icon: TrendingUp },
    { label: "Settings", to: "/app", icon: Settings },
  ],
  manager: [
    { label: "Overview", to: "/app", icon: TrendingUp },
    { label: "Appointments", to: "/app/appointments", icon: CalendarClock },
    { label: "Clients", to: "/app/clients", icon: Users },
    { label: "Services", to: "/app/services", icon: Sparkles },
    { label: "Stock", to: "/app/stock", icon: Package },
    { label: "Staff", to: "/app/staff", icon: Users },
    { label: "Reports", to: "/app/reports", icon: TrendingUp },
  ],
  receptionist: [
    { label: "Appointments", to: "/app/appointments", icon: CalendarClock },
    { label: "Clients", to: "/app/clients", icon: Users },
    { label: "Stock", to: "/app/stock", icon: Package },
  ],
  staff: [
    { label: "My appointments", to: "/app/appointments", icon: CalendarClock },
  ],
};

export function AppShell({ children }: { children: ReactNode }) {
  const tenant = useTenant();
  const navigate = useNavigate();
  const role = tenant.data?.primaryRole ?? "staff";
  const nav = NAV_BY_ROLE[role];

  async function handleSignOut() {
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  }

  return (
    <div className="flex min-h-screen bg-background">
      <aside className="hidden w-64 shrink-0 flex-col border-r border-sidebar-border bg-sidebar p-4 md:flex">
        <Link to="/app" className="mb-8 flex items-center gap-2 px-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-md bg-primary text-primary-foreground font-display font-semibold">
            L
          </div>
          <span className="font-display text-base font-semibold text-sidebar-foreground">
            Q-Salon
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
              {tenant.data?.fullName ?? tenant.data?.email}
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
