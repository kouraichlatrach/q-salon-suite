/**
 * "Has this plan request already been applied to the brand?"
 *
 * Pulled out of the admin queue component so it can be tested directly. This
 * decides whether an admin sees a green "safe to mark processed" or an amber
 * "not applied yet", and getting it wrong in the green direction re-creates the
 * exact bug it was written to fix — a request closed with nothing done.
 *
 * It is a LIVE COMPARISON against the brand, not a workflow flag. A flag would
 * drift the moment someone applied a change without touching the queue, which
 * is the order this screen actively recommends.
 */
import { PLAN_LIMITS, type PlanTier } from "@/lib/plan-limits";

export type PlanRequestLike = {
  current_plan: PlanTier;
  current_addon_locations: number;
  requested_plan: PlanTier | null;
  requested_addon_locations_delta: number | null;
};

export type BrandLike = {
  name?: string;
  plan: PlanTier;
  addon_locations: number | null;
};

/**
 * True only when every part of the request is visibly reflected on the brand.
 *
 * Returns false whenever it cannot tell — including when the brand failed to
 * load. A false amber costs the admin one glance at the brand page; a false
 * green costs an owner their upgrade.
 */
export function looksApplied(row: PlanRequestLike, brand: BrandLike | undefined): boolean {
  if (!brand) return false;

  const checks: boolean[] = [];

  if (row.requested_plan) {
    // The second clause matters: if the brand was ALREADY on the requested tier
    // when the request was raised, matching it now proves nothing was done.
    checks.push(brand.plan === row.requested_plan && row.requested_plan !== row.current_plan);
  }

  if (row.requested_addon_locations_delta) {
    const target = row.current_addon_locations + row.requested_addon_locations_delta;
    // `>=` not `===`: an admin who granted more than asked has still granted it.
    checks.push((brand.addon_locations ?? 0) >= target);
  }

  return checks.length > 0 && checks.every(Boolean);
}

/** Plain-language statement of where the brand stands right now. */
export function describeApplied(row: PlanRequestLike, brand: BrandLike | undefined): string {
  if (!brand) return "Brand could not be loaded.";
  const parts: string[] = [];
  if (row.requested_plan) {
    parts.push(
      `Plan is ${PLAN_LIMITS[brand.plan]?.label ?? brand.plan}, asked for ${PLAN_LIMITS[row.requested_plan].label}.`,
    );
  }
  if (row.requested_addon_locations_delta) {
    const target = row.current_addon_locations + row.requested_addon_locations_delta;
    parts.push(
      `Extra locations now ${brand.addon_locations ?? 0}; asked to go from ${row.current_addon_locations} to ${target}.`,
    );
  }
  return parts.join(" ");
}
