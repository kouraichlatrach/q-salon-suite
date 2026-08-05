-- Verification for the 2026-08-05 plan restructure.
--
-- NOT YET RUN — Docker was unavailable in the session that wrote it, so there
-- was no database to execute against. Run this before trusting the add-on in
-- production; it is written to be self-contained and to leave nothing behind.
--
--   npx supabase start
--   npx supabase db reset          -- applies every migration from scratch
--   npx supabase db execute --file supabase/tests/plan_limits_verification.sql
--
-- Every check RAISES on failure, so a clean run means a pass. The whole thing
-- runs inside one transaction that is rolled back at the end.

BEGIN;

DO $$
DECLARE
  v_brand    uuid;
  v_owner    uuid := gen_random_uuid();
  v_err      text;
  v_count    int;
  v_plans    text[];
BEGIN
  RAISE NOTICE '--- 1. enum: professional exists, existing labels intact ---';

  SELECT array_agg(enumlabel ORDER BY enumsortorder)
    INTO v_plans
    FROM pg_enum e
    JOIN pg_type t ON t.oid = e.enumtypid
   WHERE t.typname = 'subscription_plan';

  IF v_plans <> ARRAY['starter','growth','professional','enterprise'] THEN
    RAISE EXCEPTION 'FAIL enum order/content: %', v_plans;
  END IF;
  RAISE NOTICE 'PASS enum = %', v_plans;

  -- No existing brand's plan may have been altered by ADD VALUE. ADD VALUE
  -- cannot rewrite rows, but assert it rather than trust it.
  SELECT count(*) INTO v_count
    FROM public.brands
   WHERE plan::text NOT IN ('starter','growth','professional','enterprise');
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'FAIL % brand(s) hold an unrecognised plan value', v_count;
  END IF;
  RAISE NOTICE 'PASS no brand holds an invalid plan value';

  RAISE NOTICE '--- 2. Professional: 3 locations allowed, 4th blocked ---';

  INSERT INTO public.brands (owner_user_id, name, plan, max_locations, max_staff_accounts, addon_locations)
  VALUES (v_owner, 'TEST Professional', 'professional', 3, 50, 0)
  RETURNING id INTO v_brand;

  INSERT INTO public.locations (brand_id, name) VALUES (v_brand, 'L1'), (v_brand, 'L2'), (v_brand, 'L3');

  SELECT count(*) INTO v_count FROM public.locations WHERE brand_id = v_brand;
  IF v_count <> 3 THEN RAISE EXCEPTION 'FAIL expected 3 locations, got %', v_count; END IF;
  RAISE NOTICE 'PASS 3 locations created on Professional';

  BEGIN
    INSERT INTO public.locations (brand_id, name) VALUES (v_brand, 'L4');
    RAISE EXCEPTION 'FAIL 4th location was allowed on Professional';
  EXCEPTION WHEN check_violation THEN
    GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
    RAISE NOTICE 'PASS 4th blocked: %', v_err;
  END;

  RAISE NOTICE '--- 3. Starter + 1 add-on: 2nd allowed, 3rd blocked ---';

  INSERT INTO public.brands (owner_user_id, name, plan, max_locations, max_staff_accounts, addon_locations)
  VALUES (v_owner, 'TEST Starter+addon', 'starter', 1, 10, 1)
  RETURNING id INTO v_brand;

  INSERT INTO public.locations (brand_id, name) VALUES (v_brand, 'S1');
  INSERT INTO public.locations (brand_id, name) VALUES (v_brand, 'S2');  -- covered by the add-on

  SELECT count(*) INTO v_count FROM public.locations WHERE brand_id = v_brand;
  IF v_count <> 2 THEN RAISE EXCEPTION 'FAIL expected 2 locations, got %', v_count; END IF;
  RAISE NOTICE 'PASS 2nd location allowed by addon_locations = 1';

  BEGIN
    INSERT INTO public.locations (brand_id, name) VALUES (v_brand, 'S3');
    RAISE EXCEPTION 'FAIL 3rd location allowed on Starter + 1 add-on';
  EXCEPTION WHEN check_violation THEN
    GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
    RAISE NOTICE 'PASS 3rd blocked: %', v_err;
  END;

  RAISE NOTICE '--- 4. Staff ceiling is hard (no add-on path) ---';

  INSERT INTO public.brands (owner_user_id, name, plan, max_locations, max_staff_accounts, addon_locations)
  VALUES (v_owner, 'TEST staff ceiling', 'starter', 1, 2, 5)   -- 5 location add-ons must NOT raise staff
  RETURNING id INTO v_brand;

  INSERT INTO public.user_roles (user_id, role, brand_id) VALUES (gen_random_uuid(), 'manager', v_brand);
  INSERT INTO public.user_roles (user_id, role, brand_id) VALUES (gen_random_uuid(), 'receptionist', v_brand);

  BEGIN
    INSERT INTO public.user_roles (user_id, role, brand_id) VALUES (gen_random_uuid(), 'staff', v_brand);
    RAISE EXCEPTION 'FAIL 3rd staff account allowed against a max of 2';
  EXCEPTION WHEN check_violation THEN
    GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
    RAISE NOTICE 'PASS staff ceiling held at 2 despite addon_locations = 5: %', v_err;
  END;

  -- Owner seats are excluded from the count, so this must still succeed.
  INSERT INTO public.user_roles (user_id, role, brand_id) VALUES (v_owner, 'owner', v_brand);
  RAISE NOTICE 'PASS owner seat does not count against the staff limit';

  RAISE NOTICE '--- 5. addon_locations CHECK bounds ---';

  BEGIN
    UPDATE public.brands SET addon_locations = -1 WHERE id = v_brand;
    RAISE EXCEPTION 'FAIL negative addon_locations accepted';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'PASS negative addon_locations rejected';
  END;

  BEGIN
    UPDATE public.brands SET addon_locations = 51 WHERE id = v_brand;
    RAISE EXCEPTION 'FAIL addon_locations = 51 accepted (max 50)';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'PASS addon_locations upper bound held';
  END;

  RAISE NOTICE 'ALL CHECKS PASSED';
END $$;

ROLLBACK;

-- ---------------------------------------------------------------------------
-- 6. The billing-column guard — see billing_guard_regression.sql
-- ---------------------------------------------------------------------------
-- Moved to its own file and made a permanent regression test, after the first
-- version of the guard shipped and blocked nothing at all (Section 4, bug
-- class 12). That test impersonates a real Owner with
-- `SET LOCAL request.jwt.claims` + `SET LOCAL ROLE authenticated`, which is the
-- only way to catch a guard that exempts the wrong party.
--
-- The browser walkthrough below stays useful as an end-to-end confirmation
-- through PostgREST, but it is no longer the only line of defence. Signed in
-- as a salon Owner (NOT a platform admin), in the devtools console:
--
--   const { data: b } = await supabase.from('brands').select('id, max_locations').single();
--   await supabase.from('brands').update({ max_locations: 999 }).eq('id', b.id);
--   // EXPECT: error 42501 — "Plan, limits and billing dates are set by
--   //         Q-Salon Suite, not from the app."
--
--   await supabase.from('brands').update({ addon_locations: 10 }).eq('id', b.id);
--   // EXPECT: the same refusal.
--
--   await supabase.from('brands').update({ name: 'Still editable' }).eq('id', b.id);
--   // EXPECT: success — ordinary settings are untouched by the guard.
--
-- Then repeat the first call signed in as a Platform Admin: it must succeed,
-- or the admin console has been locked out of its own job.
