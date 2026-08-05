/**
 * The one place plan limits and prices are written down.
 *
 * These figures are mirrored into `brands.max_locations` / `max_staff_accounts`
 * when a brand is created or its plan is changed, and the database enforces
 * them with triggers. Nothing may retype a limit or a price into a page — a
 * previous landing page did, quoted staff seats that did not match the
 * enforced ones, and would have walled an owner in two seats early.
 *
 * Money lives here as numbers, not pre-formatted strings, so a caller can
 * compare or total them. `formatQar` is the only approved renderer.
 */

export type PlanTier = "starter" | "growth" | "professional" | "enterprise";

/**
 * The sentinel stored in `brands.max_locations` / `max_staff_accounts` for
 * Enterprise. Not literally unlimited — a real integer has to go in a NOT NULL
 * integer column, and the triggers compare against it — but far above any
 * plausible real brand. Compare with `>=`, never `===`.
 */
export const UNLIMITED = 999;

export type PlanLimit = {
  locations: number;
  staff: number;
  label: string;
  /** QAR per month. `null` means no published price — talk to sales. */
  priceMonthly: number | null;
  /** QAR per year. `null` means no published price. */
  priceYearly: number | null;
  /** Whether extra locations can be bought on top of this tier. */
  addonEligible: boolean;
};

/**
 * Extra locations, sold on top of a tier's base allowance.
 *
 * Enterprise is excluded because its location count is already unlimited;
 * selling an add-on against it would be selling nothing.
 */
export const EXTRA_LOCATION_ADDON = {
  priceMonthly: 299,
} as const;

export const PLAN_LIMITS: Record<PlanTier, PlanLimit> = {
  starter: {
    locations: 1,
    staff: 10,
    label: "Starter",
    priceMonthly: 549,
    priceYearly: 5600,
    addonEligible: true,
  },
  growth: {
    locations: 1,
    staff: 20,
    label: "Growth",
    priceMonthly: 849,
    priceYearly: 8660,
    addonEligible: true,
  },
  professional: {
    locations: 3,
    staff: 50,
    label: "Professional",
    priceMonthly: 1999,
    priceYearly: 20390,
    addonEligible: true,
  },
  enterprise: {
    locations: UNLIMITED,
    staff: UNLIMITED,
    label: "Enterprise",
    priceMonthly: null,
    priceYearly: null,
    addonEligible: false,
  },
};

/**
 * Staff counts exclude the Owner's own login — `enforce_staff_plan_limit`
 * skips rows with role 'owner', so the wording here has to say so or an owner
 * will believe they have one seat fewer than they do.
 */
export const PLAN_FEATURES: Record<PlanTier, string[]> = {
  starter: [
    "1 location",
    "Up to 10 staff accounts",
    "Appointments & clients",
    "Stock tracking",
    "Basic reports",
  ],
  growth: [
    "1 location",
    "Up to 20 staff accounts",
    "All Starter features",
    "Per-location pricing",
    "Advanced reports",
  ],
  professional: [
    "Up to 3 locations",
    "Up to 50 staff accounts",
    "All Growth features",
    "Multi-branch reporting",
    "Priority support",
  ],
  enterprise: [
    "Unlimited locations",
    "Unlimited staff",
    "All Professional features",
    "Custom onboarding",
    "Dedicated success lead",
  ],
};

/** Tier order for display. Object key order is not a contract; this is. */
export const PLAN_ORDER: PlanTier[] = ["starter", "growth", "professional", "enterprise"];

export function formatQar(amount: number): string {
  return `QAR ${new Intl.NumberFormat("en-QA", { maximumFractionDigits: 0 }).format(amount)}`;
}

/** True when the tier's stored limit is the unlimited sentinel. */
export function isUnlimited(value: number): boolean {
  return value >= UNLIMITED;
}
