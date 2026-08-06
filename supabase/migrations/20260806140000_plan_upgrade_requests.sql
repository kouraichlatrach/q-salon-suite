-- plan_upgrade_requests — an Owner asks; a human answers.
--
-- WHAT THIS TABLE IS NOT. It is not a way to change a plan. Nothing here writes
-- to `brands`, and nothing here may ever be made to. The whole reason this
-- feature exists is that `guard_brand_billing_columns` (Section 4, bug class 12)
-- deliberately makes plan, limits, add-ons and billing dates unwritable by an
-- Owner — so the product needed a legitimate "ask for more" path that routes
-- AROUND that guard's user interface without weakening the guard itself.
--
-- The distinction is the entire security design, so state it plainly: an Owner
-- can insert a row saying "I would like Professional". A Platform Admin reads
-- it, goes to the existing /admin brand detail screen, and makes the change
-- there through the already-guarded, already-regression-tested write path. Then
-- they mark the request processed. Marking a request processed changes nothing
-- about the brand.
--
-- If a future change adds a trigger on this table that touches `brands`, or an
-- RPC that applies a request automatically, it has re-opened exactly the hole
-- the billing guard closed — and it will look like a convenience feature while
-- doing it. supabase/tests/plan_request_regression.sql asserts the separation.

CREATE TYPE public.plan_request_status AS ENUM ('pending', 'processed', 'declined');

CREATE TABLE IF NOT EXISTS public.plan_upgrade_requests (
  id                              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id                        uuid NOT NULL REFERENCES public.brands(id) ON DELETE CASCADE,
  requested_by                    uuid NOT NULL,
  -- Snapshot of what they were on when they asked. Overwritten from `brands` by
  -- a trigger below rather than trusted from the client, so the admin reading
  -- the queue cannot be shown a plan the brand was never on.
  current_plan                    public.subscription_plan NOT NULL,
  -- Null when the request is add-ons only.
  requested_plan                  public.subscription_plan,
  -- Null when the request is a tier change only. Positive = more locations.
  requested_addon_locations_delta int,
  status                          public.plan_request_status NOT NULL DEFAULT 'pending',
  notes                           text,
  created_at                      timestamptz NOT NULL DEFAULT now(),
  processed_at                    timestamptz,
  processed_by                    uuid,

  -- A request that asks for nothing is noise in the admin queue.
  CONSTRAINT plan_request_asks_for_something CHECK (
    requested_plan IS NOT NULL OR requested_addon_locations_delta IS NOT NULL
  ),
  -- Mirrors the range the admin screen already enforces on addon_locations.
  CONSTRAINT plan_request_addon_delta_sane CHECK (
    requested_addon_locations_delta IS NULL
    OR (requested_addon_locations_delta > 0 AND requested_addon_locations_delta <= 50)
  ),
  -- A row that is not pending must say who closed it and when; a pending row
  -- must not pretend it was closed.
  CONSTRAINT plan_request_processed_fields_consistent CHECK (
    (status = 'pending'  AND processed_at IS NULL AND processed_by IS NULL)
    OR (status <> 'pending' AND processed_at IS NOT NULL AND processed_by IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS plan_upgrade_requests_brand_idx
  ON public.plan_upgrade_requests (brand_id, created_at DESC);
-- Partial index: the admin badge counts pending rows on every page load, and
-- that count should stay cheap as processed rows accumulate.
CREATE INDEX IF NOT EXISTS plan_upgrade_requests_pending_idx
  ON public.plan_upgrade_requests (created_at DESC) WHERE status = 'pending';

COMMENT ON TABLE public.plan_upgrade_requests IS
  'Owner-initiated requests for a higher tier or more location add-ons. A record of intent only — nothing here writes to brands. Plan changes are applied by a Platform Admin through /admin, which is the path guard_brand_billing_columns permits.';

GRANT SELECT, INSERT ON public.plan_upgrade_requests TO authenticated;
GRANT UPDATE (status, processed_at, processed_by) ON public.plan_upgrade_requests TO authenticated;
GRANT ALL ON public.plan_upgrade_requests TO service_role;
ALTER TABLE public.plan_upgrade_requests ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- current_plan is taken from the database, never from the client.
--
-- RLS filters rows, not columns (bug class 10), so the INSERT policy below
-- cannot stop an Owner supplying whatever current_plan they like. Rather than
-- trust it, overwrite it. The admin's queue then shows what the brand is
-- actually on, which is the number the admin will act against.
--
-- Reads brands. Writes nothing. That direction is the whole point.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.stamp_plan_request_current_plan()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
BEGIN
  SELECT b.plan INTO NEW.current_plan FROM public.brands b WHERE b.id = NEW.brand_id;
  IF NEW.current_plan IS NULL THEN
    RAISE EXCEPTION 'plan_request_unknown_brand: no brand %', NEW.brand_id;
  END IF;
  RETURN NEW;
END $function$;

DROP TRIGGER IF EXISTS stamp_plan_request_current_plan_trg ON public.plan_upgrade_requests;
CREATE TRIGGER stamp_plan_request_current_plan_trg
  BEFORE INSERT ON public.plan_upgrade_requests
  FOR EACH ROW EXECUTE FUNCTION public.stamp_plan_request_current_plan();

-- ---------------------------------------------------------------------------
-- RLS. Billing-adjacent, so the same tier as `brands` itself: Owner and
-- Platform Admin only. Manager, Receptionist and Staff get nothing — not even
-- read. What a salon pays is not roster information.
-- ---------------------------------------------------------------------------

-- Owner may raise a request for their OWN brand, as themselves, and only in the
-- pending state. Without the status/processed_at/processed_by clauses an Owner
-- could insert a row that already claims to be processed — RLS would happily
-- allow it, because the policy governs which rows may be written, not which
-- columns within them.
DROP POLICY IF EXISTS "Owner raises requests for own brand" ON public.plan_upgrade_requests;
CREATE POLICY "Owner raises requests for own brand"
  ON public.plan_upgrade_requests FOR INSERT TO authenticated
  WITH CHECK (
    public.is_brand_owner(auth.uid(), brand_id)
    AND requested_by = auth.uid()
    AND status = 'pending'
    AND processed_at IS NULL
    AND processed_by IS NULL
  );

DROP POLICY IF EXISTS "Owner reads own brand requests" ON public.plan_upgrade_requests;
CREATE POLICY "Owner reads own brand requests"
  ON public.plan_upgrade_requests FOR SELECT TO authenticated
  USING (public.is_brand_owner(auth.uid(), brand_id));

-- Deliberately NO update policy for the Owner. They may ask and they may watch;
-- they may not mark their own request processed.

DROP POLICY IF EXISTS "Platform admins read all requests" ON public.plan_upgrade_requests;
CREATE POLICY "Platform admins read all requests"
  ON public.plan_upgrade_requests FOR SELECT TO authenticated
  USING (public.is_platform_admin(auth.uid()));

DROP POLICY IF EXISTS "Platform admins resolve requests" ON public.plan_upgrade_requests;
CREATE POLICY "Platform admins resolve requests"
  ON public.plan_upgrade_requests FOR UPDATE TO authenticated
  USING (public.is_platform_admin(auth.uid()))
  WITH CHECK (public.is_platform_admin(auth.uid()));

-- No DELETE policy for anyone. A request that was raised, was raised; the queue
-- is a record of what owners asked for and what was done about it.
--
-- Note on tier ordering: the UI offers only tiers above the current one, using
-- PLAN_ORDER from src/lib/plan-limits.ts. That ordering is deliberately NOT
-- re-encoded here. The subscription_plan enum's own ordinal order is not
-- meaningful ('professional' was appended after 'enterprise'), so a SQL-side
-- check would have to hard-code a second copy of the tier ranking — the exact
-- duplicate-source-of-truth problem plan-limits.ts exists to prevent. Nothing
-- is lost by omitting it: a request is read by a human before anything happens,
-- and a downgrade request is a legitimate thing for an owner to send anyway.
