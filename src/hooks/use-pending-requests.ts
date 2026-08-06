import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

/**
 * Count of plan requests still waiting on a Platform Admin.
 *
 * Lives in its own module rather than in the /admin/requests route file so the
 * admin layout can import it without pulling a route component into its module
 * graph (and without tripping react-refresh's component-only export rule).
 *
 * `head: true` means Postgres returns the count without the rows — the header
 * needs a number, not a payload. RLS still applies, so a non-admin gets 0
 * rather than a leak.
 */
export function usePendingRequestCount() {
  return useQuery({
    queryKey: ["admin-pending-requests"],
    queryFn: async () => {
      const { count, error } = await supabase
        .from("plan_upgrade_requests")
        .select("id", { count: "exact", head: true })
        .eq("status", "pending");
      if (error) throw error;
      return count ?? 0;
    },
    refetchInterval: 60_000,
  });
}
