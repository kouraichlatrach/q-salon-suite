export type PlanTier = "starter" | "growth" | "enterprise";

export const PLAN_LIMITS: Record<PlanTier, { locations: number; staff: number; label: string; priceMonthly: string; priceYearly: string }> = {
  starter: { locations: 1, staff: 3, label: "Starter", priceMonthly: "Contact sales", priceYearly: "Contact sales" },
  growth: { locations: 3, staff: 10, label: "Growth", priceMonthly: "Contact sales", priceYearly: "Contact sales" },
  enterprise: { locations: 999, staff: 999, label: "Enterprise", priceMonthly: "Custom", priceYearly: "Custom" },
};

export const PLAN_FEATURES: Record<PlanTier, string[]> = {
  starter: ["1 location", "Up to 3 staff accounts", "Appointments & clients", "Stock tracking", "Basic reports"],
  growth: ["Up to 3 locations", "Up to 10 staff accounts", "All Starter features", "Per-location pricing", "Advanced reports"],
  enterprise: ["Unlimited locations", "Unlimited staff", "All Growth features", "Priority support", "Custom onboarding"],
};
