-- REGRESSION TEST — an Owner must never be able to write a billing column.
--
-- Why this exists: guard_brand_billing_columns shipped, applied cleanly, and
-- blocked nothing at all. It tested `current_user` from inside a SECURITY
-- DEFINER function, where `current_user` is the function's owner (`postgres`)
-- rather than the caller, so every invocation took the exempt branch. Code
-- review missed it, `db push` reported success, and the schema looked correct.
-- Only a real Owner-session write revealed it.
--
-- The one thing that catches this class of bug is impersonating the actual
-- role, which is what the block below does:
--
--     SET LOCAL request.jwt.claims = '{"sub": ..., "role": "authenticated"}'
--     SET LOCAL ROLE authenticated
--
-- Run it against the BUGGY version and it fails at the first assertion; run it
-- against the fixed one and every assertion passes. A test that cannot fail
-- against the original bug would be decoration.
--
-- HOW TO RUN
--   Easiest: paste the whole file into the Supabase dashboard SQL editor.
--   (The editor connects as `postgres`; SET LOCAL ROLE works there, and the
--   final ROLLBACK means nothing is left behind.)
--   Locally: `supabase db reset` then run this file, once Docker is available.
--
-- Everything runs in one transaction and is rolled back. Fixture ids are fixed
-- (not random) because SET LOCAL takes a literal and cannot interpolate.

BEGIN;

-- Refuse to run if the fixture ids somehow already exist, rather than
-- silently trampling a real row.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.brands WHERE id = '00000000-0000-4000-8000-00000000b41d')
     OR EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = '00000000-0000-4000-8000-00000000ba51') THEN
    RAISE EXCEPTION 'ABORT: regression fixture ids already present; refusing to run';
  END IF;
END $$;

INSERT INTO public.brands (
  id, owner_user_id, name, slug, plan,
  max_locations, max_staff_accounts, addon_locations, subscription_status, billing_cycle
) VALUES (
  '00000000-0000-4000-8000-00000000b41d',
  '00000000-0000-4000-8000-00000000ba51',
  'ZZ billing-guard regression fixture',
  'zz-billing-guard-regression-fixture',
  'starter', 1, 10, 0, 'trial', 'monthly'
);

-- The RLS policy "Owner updates own brand" is satisfied via user_roles, so
-- this row is what lets the impersonated session reach the trigger at all.
INSERT INTO public.user_roles (user_id, role, brand_id)
VALUES ('00000000-0000-4000-8000-00000000ba51', 'owner', '00000000-0000-4000-8000-00000000b41d');

-- Become a signed-in Owner: a JWT with a subject, the `authenticated` role,
-- and no platform-admin grant.
SET LOCAL request.jwt.claims = '{"sub":"00000000-0000-4000-8000-00000000ba51","role":"authenticated"}';
SET LOCAL ROLE authenticated;

DO $$
DECLARE
  v_brand   uuid := '00000000-0000-4000-8000-00000000b41d';
  v_blocked int  := 0;
  v_name    text;
BEGIN
  -- Precondition. If RLS alone were rejecting the write, UPDATE would report
  -- zero rows rather than raise, and every assertion below would "pass" for
  -- entirely the wrong reason. Prove the Owner can reach this row first.
  UPDATE public.brands SET name = name WHERE id = v_brand;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ABORT: RLS blocked the owner outright; the guard assertions would be meaningless';
  END IF;
  RAISE NOTICE 'precondition OK — owner reaches the row, benign update allowed';

  -- Each billing column, one at a time.
  BEGIN
    UPDATE public.brands SET max_locations = 999 WHERE id = v_brand;
    RAISE EXCEPTION 'FAIL: max_locations was writable by an Owner';
  EXCEPTION WHEN insufficient_privilege THEN v_blocked := v_blocked + 1;
  END;

  BEGIN
    UPDATE public.brands SET addon_locations = 10 WHERE id = v_brand;
    RAISE EXCEPTION 'FAIL: addon_locations was writable by an Owner';
  EXCEPTION WHEN insufficient_privilege THEN v_blocked := v_blocked + 1;
  END;

  BEGIN
    UPDATE public.brands SET max_staff_accounts = 500 WHERE id = v_brand;
    RAISE EXCEPTION 'FAIL: max_staff_accounts was writable by an Owner';
  EXCEPTION WHEN insufficient_privilege THEN v_blocked := v_blocked + 1;
  END;

  BEGIN
    UPDATE public.brands SET plan = 'enterprise' WHERE id = v_brand;
    RAISE EXCEPTION 'FAIL: plan was writable by an Owner';
  EXCEPTION WHEN insufficient_privilege THEN v_blocked := v_blocked + 1;
  END;

  BEGIN
    UPDATE public.brands SET subscription_status = 'active' WHERE id = v_brand;
    RAISE EXCEPTION 'FAIL: subscription_status was writable by an Owner';
  EXCEPTION WHEN insufficient_privilege THEN v_blocked := v_blocked + 1;
  END;

  BEGIN
    UPDATE public.brands SET billing_cycle = 'yearly' WHERE id = v_brand;
    RAISE EXCEPTION 'FAIL: billing_cycle was writable by an Owner';
  EXCEPTION WHEN insufficient_privilege THEN v_blocked := v_blocked + 1;
  END;

  BEGIN
    UPDATE public.brands SET renewal_date = current_date WHERE id = v_brand;
    RAISE EXCEPTION 'FAIL: renewal_date was writable by an Owner';
  EXCEPTION WHEN insufficient_privilege THEN v_blocked := v_blocked + 1;
  END;

  IF v_blocked <> 7 THEN
    RAISE EXCEPTION 'FAIL: expected 7 blocked billing columns, got %', v_blocked;
  END IF;
  RAISE NOTICE 'PASS — all 7 billing columns rejected for an Owner';

  -- The guard must not be over-broad: ordinary settings stay writable, or the
  -- Owner settings screen is broken.
  UPDATE public.brands
     SET name = 'ZZ renamed by owner', min_notice_hours = 3, whatsapp_enabled = true
   WHERE id = v_brand;
  SELECT name INTO v_name FROM public.brands WHERE id = v_brand;
  IF v_name <> 'ZZ renamed by owner' THEN
    RAISE EXCEPTION 'FAIL: an ordinary settings write did not take effect';
  END IF;
  RAISE NOTICE 'PASS — non-billing columns still writable by the Owner';

  -- Verify nothing actually changed on the billing columns.
  PERFORM 1 FROM public.brands
   WHERE id = v_brand
     AND plan = 'starter' AND max_locations = 1
     AND max_staff_accounts = 10 AND addon_locations = 0;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'FAIL: a billing column changed despite the guard raising';
  END IF;
  RAISE NOTICE 'PASS — billing columns unchanged after all rejected attempts';

  RAISE NOTICE 'ALL REGRESSION CHECKS PASSED';
END $$;

RESET ROLE;
ROLLBACK;
