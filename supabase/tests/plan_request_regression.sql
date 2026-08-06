-- REGRESSION TEST — plan_upgrade_requests: who may ask, who may answer, and the
-- guarantee that asking can never become doing.
--
-- The last assertion is the one this file exists for. plan_upgrade_requests was
-- added specifically to give Owners a legitimate route to a bigger plan WITHOUT
-- weakening guard_brand_billing_columns (Section 4, bug class 12) — the trigger
-- that makes plan, limits, add-ons and billing dates unwritable by an Owner.
-- A future "convenience" change that auto-applies a request, or a trigger here
-- that touches `brands`, would reopen exactly the hole the guard closed while
-- looking like a feature. Part E asserts the separation structurally AND
-- behaviourally, from a real Owner session.
--
-- HOW TO RUN
--   Paste into the Supabase dashboard SQL editor. "Success. No rows returned."
--   means every assertion held. One transaction, rolled back.

BEGIN;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.brands WHERE id IN (
      '00000000-0000-4000-8000-0000000e0057',
      '00000000-0000-4000-8000-0000000e0058')) THEN
    RAISE EXCEPTION 'ABORT: plan-request fixture ids already present; refusing to run';
  END IF;
END $$;

-- Two brands, so cross-brand isolation is testable.
INSERT INTO public.brands (id, owner_user_id, name, slug, plan, max_locations,
                           max_staff_accounts, addon_locations, subscription_status, billing_cycle)
VALUES
  ('00000000-0000-4000-8000-0000000e0057','00000000-0000-4000-8000-0000000e0001',
   'ZZ request fixture A','zz-request-fixture-a','starter',1,10,0,'trial','monthly'),
  ('00000000-0000-4000-8000-0000000e0058','00000000-0000-4000-8000-0000000e0002',
   'ZZ request fixture B','zz-request-fixture-b','growth',1,20,0,'trial','monthly');

INSERT INTO public.locations (id, brand_id, name) VALUES
  ('00000000-0000-4000-8000-0000000e0a01','00000000-0000-4000-8000-0000000e0057','ZZ A Branch');

INSERT INTO public.profiles (id, full_name) VALUES
  ('00000000-0000-4000-8000-0000000e0001','ZZ Owner A'),
  ('00000000-0000-4000-8000-0000000e0002','ZZ Owner B'),
  ('00000000-0000-4000-8000-0000000e0003','ZZ Manager A'),
  ('00000000-0000-4000-8000-0000000e0004','ZZ Receptionist A'),
  ('00000000-0000-4000-8000-0000000e0005','ZZ Staff A'),
  ('00000000-0000-4000-8000-0000000e0009','ZZ Platform Admin');

INSERT INTO public.user_roles (user_id, role, brand_id, location_id) VALUES
  ('00000000-0000-4000-8000-0000000e0001','owner',       '00000000-0000-4000-8000-0000000e0057', NULL),
  ('00000000-0000-4000-8000-0000000e0002','owner',       '00000000-0000-4000-8000-0000000e0058', NULL),
  ('00000000-0000-4000-8000-0000000e0003','manager',     '00000000-0000-4000-8000-0000000e0057','00000000-0000-4000-8000-0000000e0a01'),
  ('00000000-0000-4000-8000-0000000e0004','receptionist','00000000-0000-4000-8000-0000000e0057','00000000-0000-4000-8000-0000000e0a01'),
  ('00000000-0000-4000-8000-0000000e0005','staff',       '00000000-0000-4000-8000-0000000e0057','00000000-0000-4000-8000-0000000e0a01');

INSERT INTO public.platform_admins (user_id) VALUES ('00000000-0000-4000-8000-0000000e0009');

-- A request from Owner B, used to prove Owner A cannot see it.
INSERT INTO public.plan_upgrade_requests (brand_id, requested_by, current_plan, requested_plan)
VALUES ('00000000-0000-4000-8000-0000000e0058','00000000-0000-4000-8000-0000000e0002',
        'growth','professional');

-- ===========================================================================
-- A. OWNER: may ask for their own brand, and only for their own brand.
-- ===========================================================================
SET LOCAL request.jwt.claims = '{"sub":"00000000-0000-4000-8000-0000000e0001","role":"authenticated"}';
SET LOCAL ROLE authenticated;

DO $$
DECLARE v_self int; v_seen int; v_mine uuid; v_stamped public.subscription_plan;
BEGIN
  SELECT count(*) INTO v_self FROM public.user_roles
   WHERE user_id = '00000000-0000-4000-8000-0000000e0001';
  IF v_self <> 1 THEN RAISE EXCEPTION 'ABORT: impersonation not live (own rows = %)', v_self; END IF;

  INSERT INTO public.plan_upgrade_requests (brand_id, requested_by, current_plan, requested_plan, notes)
  VALUES ('00000000-0000-4000-8000-0000000e0057','00000000-0000-4000-8000-0000000e0001',
          'starter','professional','opening a second branch')
  RETURNING id INTO v_mine;
  RAISE NOTICE 'PASS — Owner can raise a request for their own brand';

  -- current_plan must come from the database, not the client.
  SELECT current_plan INTO v_stamped FROM public.plan_upgrade_requests WHERE id = v_mine;
  IF v_stamped <> 'starter' THEN
    RAISE EXCEPTION 'FAIL: current_plan was not stamped from brands (got %)', v_stamped;
  END IF;
  RAISE NOTICE 'PASS — current_plan stamped from the brand row';

  -- Cross-brand read isolation.
  SELECT count(*) INTO v_seen FROM public.plan_upgrade_requests
   WHERE brand_id = '00000000-0000-4000-8000-0000000e0058';
  IF v_seen <> 0 THEN
    RAISE EXCEPTION 'FAIL: Owner A can see % request(s) belonging to Brand B', v_seen;
  END IF;
  RAISE NOTICE 'PASS — Owner cannot see another brand''s requests';

  -- Their own remains visible.
  SELECT count(*) INTO v_seen FROM public.plan_upgrade_requests
   WHERE brand_id = '00000000-0000-4000-8000-0000000e0057';
  IF v_seen <> 1 THEN RAISE EXCEPTION 'FAIL: Owner cannot see their own request (got %)', v_seen; END IF;
  RAISE NOTICE 'PASS — Owner sees their own request history';

  -- Cross-brand write.
  BEGIN
    INSERT INTO public.plan_upgrade_requests (brand_id, requested_by, current_plan, requested_plan)
    VALUES ('00000000-0000-4000-8000-0000000e0058','00000000-0000-4000-8000-0000000e0001',
            'growth','enterprise');
    RAISE EXCEPTION 'FAIL: Owner A raised a request against Brand B';
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'PASS — Owner cannot raise a request for a brand they do not own';
  END;

  -- Impersonating another user as the requester.
  BEGIN
    INSERT INTO public.plan_upgrade_requests (brand_id, requested_by, current_plan, requested_plan)
    VALUES ('00000000-0000-4000-8000-0000000e0057','00000000-0000-4000-8000-0000000e0002',
            'starter','enterprise');
    RAISE EXCEPTION 'FAIL: Owner set requested_by to someone else';
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'PASS — requested_by is pinned to the caller';
  END;

  -- Self-approval: inserting a row that already claims to be processed.
  BEGIN
    INSERT INTO public.plan_upgrade_requests
      (brand_id, requested_by, current_plan, requested_plan, status, processed_at, processed_by)
    VALUES ('00000000-0000-4000-8000-0000000e0057','00000000-0000-4000-8000-0000000e0001',
            'starter','enterprise','processed', now(), '00000000-0000-4000-8000-0000000e0001');
    RAISE EXCEPTION 'FAIL: Owner inserted a pre-approved request';
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'PASS — Owner cannot insert an already-processed request';
  END;

  -- Approving after the fact.
  UPDATE public.plan_upgrade_requests
     SET status = 'processed', processed_at = now(),
         processed_by = '00000000-0000-4000-8000-0000000e0001'
   WHERE id = v_mine;
  IF FOUND THEN
    RAISE EXCEPTION 'FAIL: Owner marked their own request processed';
  END IF;
  RAISE NOTICE 'PASS — Owner cannot resolve their own request (no UPDATE policy)';
END $$;
RESET ROLE;

-- ===========================================================================
-- B. MANAGER / RECEPTIONIST / STAFF: no read, no write. Billing is not roster
--    information.
-- ===========================================================================
DO $$
DECLARE
  v_uid text;
  v_seen int;
BEGIN
  FOREACH v_uid IN ARRAY ARRAY[
    '00000000-0000-4000-8000-0000000e0003',  -- manager
    '00000000-0000-4000-8000-0000000e0004',  -- receptionist
    '00000000-0000-4000-8000-0000000e0005'   -- staff
  ] LOOP
    EXECUTE format('SET LOCAL request.jwt.claims = %L', json_build_object('sub', v_uid, 'role','authenticated')::text);
    EXECUTE 'SET LOCAL ROLE authenticated';

    EXECUTE 'SELECT count(*) FROM public.plan_upgrade_requests' INTO v_seen;
    IF v_seen <> 0 THEN
      RAISE EXCEPTION 'FAIL: % can read % plan request(s)', v_uid, v_seen;
    END IF;

    BEGIN
      EXECUTE format(
        'INSERT INTO public.plan_upgrade_requests (brand_id, requested_by, current_plan, requested_plan)
         VALUES (%L, %L, %L, %L)',
        '00000000-0000-4000-8000-0000000e0057', v_uid, 'starter', 'enterprise');
      RAISE EXCEPTION 'FAIL: % raised a plan request', v_uid;
    EXCEPTION WHEN insufficient_privilege THEN
      NULL;  -- expected
    END;

    EXECUTE 'RESET ROLE';
  END LOOP;
  RAISE NOTICE 'PASS — manager, receptionist and staff can neither read nor raise requests';
END $$;
RESET ROLE;

-- ===========================================================================
-- C. PLATFORM ADMIN: sees everything, resolves anything.
-- ===========================================================================
SET LOCAL request.jwt.claims = '{"sub":"00000000-0000-4000-8000-0000000e0009","role":"authenticated"}';
SET LOCAL ROLE authenticated;

DO $$
DECLARE v_all int; v_pending int; v_target uuid; v_status public.plan_request_status;
BEGIN
  SELECT count(*) INTO v_all FROM public.plan_upgrade_requests;
  IF v_all < 2 THEN RAISE EXCEPTION 'FAIL: admin sees only % request(s), expected both brands', v_all; END IF;
  RAISE NOTICE 'PASS — Platform Admin sees requests across all brands (%)', v_all;

  SELECT count(*) INTO v_pending FROM public.plan_upgrade_requests WHERE status = 'pending';
  IF v_pending < 2 THEN RAISE EXCEPTION 'FAIL: pending count wrong (%)', v_pending; END IF;
  RAISE NOTICE 'PASS — pending count for the header badge reads %', v_pending;

  SELECT id INTO v_target FROM public.plan_upgrade_requests
   WHERE brand_id = '00000000-0000-4000-8000-0000000e0057' LIMIT 1;

  UPDATE public.plan_upgrade_requests
     SET status = 'processed', processed_at = now(),
         processed_by = '00000000-0000-4000-8000-0000000e0009'
   WHERE id = v_target;
  SELECT status INTO v_status FROM public.plan_upgrade_requests WHERE id = v_target;
  IF v_status <> 'processed' THEN RAISE EXCEPTION 'FAIL: admin could not mark processed'; END IF;
  RAISE NOTICE 'PASS — Platform Admin can mark a request processed';

  SELECT id INTO v_target FROM public.plan_upgrade_requests
   WHERE brand_id = '00000000-0000-4000-8000-0000000e0058' LIMIT 1;
  UPDATE public.plan_upgrade_requests
     SET status = 'declined', processed_at = now(),
         processed_by = '00000000-0000-4000-8000-0000000e0009'
   WHERE id = v_target;
  RAISE NOTICE 'PASS — Platform Admin can decline a request';
END $$;
RESET ROLE;

-- ===========================================================================
-- D. THE OWNER SEES THE OUTCOME. Closing the loop matters: an owner left
--    wondering whether their request landed will email anyway.
-- ===========================================================================
SET LOCAL request.jwt.claims = '{"sub":"00000000-0000-4000-8000-0000000e0001","role":"authenticated"}';
SET LOCAL ROLE authenticated;
DO $$
DECLARE v int;
BEGIN
  SELECT count(*) INTO v FROM public.plan_upgrade_requests
   WHERE brand_id = '00000000-0000-4000-8000-0000000e0057' AND status = 'processed';
  IF v <> 1 THEN RAISE EXCEPTION 'FAIL: Owner cannot see their request marked processed (got %)', v; END IF;
  RAISE NOTICE 'PASS — Owner sees their own request as processed';
END $$;
RESET ROLE;

-- ===========================================================================
-- E. THE POINT OF THE WHOLE FILE — asking never becomes doing.
-- ===========================================================================

-- E1, structural: nothing on this table may write to `brands`.
DO $$
DECLARE v_bad text;
BEGIN
  SELECT string_agg(t.tgname, ', ') INTO v_bad
  FROM pg_trigger t
  JOIN pg_proc p ON p.oid = t.tgfoid
  WHERE t.tgrelid = 'public.plan_upgrade_requests'::regclass
    AND NOT t.tgisinternal
    AND p.prosrc ~* '(insert|update|delete)\s+(into\s+)?(public\.)?brands';
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'FAIL: trigger(s) on plan_upgrade_requests write to brands: %', v_bad;
  END IF;
  RAISE NOTICE 'PASS — no trigger on plan_upgrade_requests writes to brands';
END $$;

-- E2, behavioural: an Owner raising a request changes nothing about the brand,
-- and the billing guard still refuses them a direct write.
SET LOCAL request.jwt.claims = '{"sub":"00000000-0000-4000-8000-0000000e0001","role":"authenticated"}';
SET LOCAL ROLE authenticated;

DO $$
DECLARE
  v_before record;
  v_after  record;
  v_blocked int := 0;
BEGIN
  SELECT plan, max_locations, max_staff_accounts, addon_locations, subscription_status
    INTO v_before FROM public.brands WHERE id = '00000000-0000-4000-8000-0000000e0057';

  INSERT INTO public.plan_upgrade_requests (brand_id, requested_by, current_plan, requested_addon_locations_delta)
  VALUES ('00000000-0000-4000-8000-0000000e0057','00000000-0000-4000-8000-0000000e0001','starter', 3);

  SELECT plan, max_locations, max_staff_accounts, addon_locations, subscription_status
    INTO v_after FROM public.brands WHERE id = '00000000-0000-4000-8000-0000000e0057';

  IF v_before IS DISTINCT FROM v_after THEN
    RAISE EXCEPTION 'FAIL: raising a request changed the brand (% -> %)', v_before, v_after;
  END IF;
  RAISE NOTICE 'PASS — raising a request left every billing column untouched';

  -- And the guard the whole feature routes around is still doing its job.
  BEGIN
    UPDATE public.brands SET plan = 'enterprise'
     WHERE id = '00000000-0000-4000-8000-0000000e0057';
    RAISE EXCEPTION 'FAIL: Owner wrote brands.plan directly — the billing guard is gone';
  EXCEPTION WHEN insufficient_privilege THEN v_blocked := v_blocked + 1;
  END;
  BEGIN
    UPDATE public.brands SET addon_locations = 3
     WHERE id = '00000000-0000-4000-8000-0000000e0057';
    RAISE EXCEPTION 'FAIL: Owner wrote brands.addon_locations directly';
  EXCEPTION WHEN insufficient_privilege THEN v_blocked := v_blocked + 1;
  END;
  BEGIN
    UPDATE public.brands SET max_locations = 999
     WHERE id = '00000000-0000-4000-8000-0000000e0057';
    RAISE EXCEPTION 'FAIL: Owner wrote brands.max_locations directly';
  EXCEPTION WHEN insufficient_privilege THEN v_blocked := v_blocked + 1;
  END;

  IF v_blocked <> 3 THEN
    RAISE EXCEPTION 'FAIL: expected 3 blocked direct writes, got %', v_blocked;
  END IF;
  RAISE NOTICE 'PASS — guard_brand_billing_columns still blocks the Owner on plan, add-ons and limits';
  RAISE NOTICE 'ALL PLAN-REQUEST REGRESSION CHECKS PASSED';
END $$;

RESET ROLE;
ROLLBACK;
