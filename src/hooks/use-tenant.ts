import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type AppRole = "owner" | "manager" | "receptionist" | "staff";

export interface UserRoleRow {
  id: string;
  user_id: string;
  role: AppRole;
  brand_id: string;
  location_id: string | null;
}

export interface TenantContext {
  userId: string | null;
  email: string | null;
  fullName: string | null;
  roles: UserRoleRow[];
  primaryRole: AppRole | null;
  brandId: string | null;
  locationId: string | null;
  isPlatformAdmin: boolean;
}

/**
 * Fetches the signed-in user together with their role assignments and platform-admin flag.
 * Returns tenant context used to gate navigation and choose data fetchers.
 */
export function useTenant() {
  return useQuery<TenantContext>({
    queryKey: ["tenant-context"],
    queryFn: async () => {
      const { data: userData } = await supabase.auth.getUser();
      const user = userData.user;
      if (!user) {
        return {
          userId: null,
          email: null,
          fullName: null,
          roles: [],
          primaryRole: null,
          brandId: null,
          locationId: null,
          isPlatformAdmin: false,
        };
      }

      const [profileRes, rolesRes, adminRes] = await Promise.all([
        supabase.from("profiles").select("full_name").eq("id", user.id).maybeSingle(),
        supabase.from("user_roles").select("id, user_id, role, brand_id, location_id").eq("user_id", user.id),
        supabase.from("platform_admins").select("user_id").eq("user_id", user.id).maybeSingle(),
      ]);

      const roles = (rolesRes.data ?? []) as UserRoleRow[];
      // Priority: owner > manager > receptionist > staff
      const order: AppRole[] = ["owner", "manager", "receptionist", "staff"];
      const primaryRole =
        order.find((r) => roles.some((x) => x.role === r)) ?? null;
      const primary = primaryRole ? roles.find((r) => r.role === primaryRole)! : null;

      return {
        userId: user.id,
        email: user.email ?? null,
        fullName: profileRes.data?.full_name ?? null,
        roles,
        primaryRole,
        brandId: primary?.brand_id ?? null,
        locationId: primary?.location_id ?? null,
        isPlatformAdmin: Boolean(adminRes.data),
      };
    },
    staleTime: 30_000,
  });
}
