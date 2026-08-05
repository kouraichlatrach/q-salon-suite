-- Per-location add-ons, plus a guard on the columns that decide what a brand
-- is allowed to have.
--
-- Two things happen here and they are not separable: the add-on turns the
-- location ceiling from a fixed number into a purchased one, and the guard is
-- what stops the purchase being free.

-- ---------------------------------------------------------------------------
-- 1. addon_locations
-- ---------------------------------------------------------------------------
-- Extra locations bought on top of the tier's base allowance. Sold at a flat
-- monthly rate per location (see src/lib/plan-limits.ts). There is no
-- self-serve purchase flow yet: a Platform Admin sets this by hand after the
-- owner asks, exactly as plan changes are handled today.

ALTER TABLE public.brands
  ADD COLUMN IF NOT EXISTS addon_locations integer NOT NULL DEFAULT 0;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'brands_addon_locations_chk'
  ) THEN
    -- Upper bound is a typo guard, not a business rule: someone entering
    -- "100" where they meant "1" in the admin form should not silently hand
    -- out ninety-nine free branches. A brand genuinely needing more than 50
    -- extra locations belongs on Enterprise.
    ALTER TABLE public.brands ADD CONSTRAINT brands_addon_locations_chk
      CHECK (addon_locations >= 0 AND addon_locations <= 50);
  END IF;
END $$;

COMMENT ON COLUMN public.brands.addon_locations IS
  'Extra locations purchased on top of the plan tier''s base max_locations. Set by Platform Admin only; guarded by guard_brand_billing_columns.';

-- ---------------------------------------------------------------------------
-- 2. Location limit becomes base + purchased
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.enforce_location_plan_limit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  current_count INT;
  base_allowed  INT;
  addon_allowed INT;
  max_allowed   INT;
BEGIN
  -- Serialise per brand for the rest of the transaction.
  --
  -- Without this, two concurrent inserts both read the same count, both see
  -- room, and both commit — so a brand on a one-location plan ends up with
  -- two. Read-then-write against a limit is never safe on its own, and this
  -- limit is now something a customer pays for, which makes the race a
  -- revenue bug rather than a tidiness one. The lock is keyed on the brand,
  -- so unrelated brands never contend, and it releases at commit.
  PERFORM pg_advisory_xact_lock(hashtext(NEW.brand_id::text));

  SELECT max_locations, COALESCE(addon_locations, 0)
    INTO base_allowed, addon_allowed
    FROM public.brands
   WHERE id = NEW.brand_id;

  -- No brand row, or no ceiling recorded: leave the insert alone rather than
  -- inventing a limit. Matches the previous behaviour.
  IF base_allowed IS NULL THEN
    RETURN NEW;
  END IF;

  max_allowed := base_allowed + addon_allowed;

  SELECT COUNT(*) INTO current_count
    FROM public.locations
   WHERE brand_id = NEW.brand_id;

  IF current_count >= max_allowed THEN
    RAISE EXCEPTION
      'Location limit reached for this brand (% included, % purchased, % total). Upgrade the plan or add an extra location.',
      base_allowed, addon_allowed, max_allowed
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS enforce_location_plan_limit_trigger ON public.locations;
CREATE TRIGGER enforce_location_plan_limit_trigger
BEFORE INSERT ON public.locations
FOR EACH ROW EXECUTE FUNCTION public.enforce_location_plan_limit();

-- Staff limits are deliberately NOT changed. No staff add-on is specced, so
-- enforce_staff_plan_limit stays a hard per-tier ceiling. It carries the same
-- read-then-write race as the location trigger did; that is worth fixing, but
-- it is not this migration's job and inventing a fix for an unpaid limit here
-- would widen a billing change into an unrelated one.

-- ---------------------------------------------------------------------------
-- 3. Guard the billing columns
-- ---------------------------------------------------------------------------
-- Found while building the add-on, and it predates it.
--
-- `GRANT SELECT, INSERT, UPDATE, DELETE ON public.brands TO authenticated`
-- combined with the "Owner updates own brand" policy gives an Owner UPDATE on
-- their own brand row. RLS filters rows, never columns, and no column-level
-- privileges were ever granted — so an Owner could set their own
-- max_locations, max_staff_accounts or plan straight from the browser with
-- their ordinary session, and both limit triggers would then happily read the
-- numbers that owner had just written for themselves.
--
-- That makes every plan limit advisory rather than enforced, and it would
-- have made the paid add-on free: set addon_locations yourself, get the
-- branches, never pay. A ceiling the constrained party can raise is not a
-- ceiling.
--
-- Ordinary brand settings (name, booking windows, deposit and gift-card
-- policy, WhatsApp) are untouched — the Owner settings screen writes only
-- those, so nothing legitimate breaks.

CREATE OR REPLACE FUNCTION public.guard_brand_billing_columns()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Server-side callers (service_role has no end-user `sub`, so auth.uid() is
  -- NULL) and migrations/superuser run unrestricted; Platform Admins are the
  -- humans allowed to sell and revoke capacity.
  IF auth.uid() IS NULL
     OR current_user IN ('postgres', 'service_role', 'supabase_admin')
     OR public.is_platform_admin(auth.uid()) THEN
    RETURN NEW;
  END IF;

  IF NEW.plan                IS DISTINCT FROM OLD.plan
     OR NEW.max_locations       IS DISTINCT FROM OLD.max_locations
     OR NEW.max_staff_accounts  IS DISTINCT FROM OLD.max_staff_accounts
     OR NEW.addon_locations     IS DISTINCT FROM OLD.addon_locations
     OR NEW.subscription_status IS DISTINCT FROM OLD.subscription_status
     OR NEW.billing_cycle       IS DISTINCT FROM OLD.billing_cycle
     OR NEW.renewal_date        IS DISTINCT FROM OLD.renewal_date THEN
    RAISE EXCEPTION
      'Plan, limits and billing dates are set by Q-Salon Suite, not from the app. Contact us to change your plan.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  RETURN NEW;
END $$;

-- Fires before the updated_at trigger's alphabetical neighbour purely by
-- name; order does not matter here because this one only ever raises or
-- passes NEW through untouched.
DROP TRIGGER IF EXISTS guard_brand_billing_columns_trg ON public.brands;
CREATE TRIGGER guard_brand_billing_columns_trg
BEFORE UPDATE ON public.brands
FOR EACH ROW EXECUTE FUNCTION public.guard_brand_billing_columns();
