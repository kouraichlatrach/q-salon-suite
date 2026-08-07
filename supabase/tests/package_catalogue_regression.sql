-- REGRESSION TEST — the package catalogue is Owner-writable only, and every
-- other brand role is refused at the database, not merely in the UI.
--
-- Why this exists: `/app/packages` gained a read-only catalogue card for
-- Managers on 2026-08-07. Before that the card was hidden entirely, so the
-- "Managers cannot create packages" claim rested on a `{isOwner && …}` in JSX.
-- Now the page deliberately SHOWS a Manager the catalogue while offering no way
-- to edit it — which is the exact shape of restriction this project has twice
-- discovered was never really enforced (§4.10 the table-wide GRANT, §4.12 the
-- billing guard that exempted everybody). A boundary the UI merely declines to
-- render is not a boundary. This file proves the policy does the work.
--
-- What is asserted:
--   A. A Manager can READ the catalogue — the precondition. Without it, every
--      "blocked" assertion below could pass because the Manager cannot reach
--      the table at all, which would prove nothing about the write rule.
--   B. A Manager cannot INSERT / UPDATE / DELETE package_types, nor add a line
--      to package_services (which would change what an existing package
--      contains without touching package_types itself).
--   C. A Receptionist is refused the same writes.
--   D. An Owner CAN insert — the positive control. A policy that blocks
--      everybody would satisfy B and C while breaking the product, and would
--      look identical in a test that only checked for refusals.
--
-- TWO POSTGRES BEHAVIOURS THIS TEST DEPENDS ON — do not "fix" the assertions
-- to be symmetric, they are asymmetric on purpose:
--
--   * A failed INSERT raises. The WITH CHECK on `package_types_manage` is
--     violated, which is SQLSTATE 42501 (insufficient_privilege).
--   * A failed UPDATE or DELETE does NOT raise. The USING clause makes the row
--     invisible for that command, so the statement affects zero rows and
--     returns quietly. Asserting an exception there would fail against
--     perfectly correct policies.
--
--   `package_types_read` is FOR SELECT only, so it grants no visibility to
--   UPDATE/DELETE — a Manager sees the row when reading and not when writing.
--
-- HOW TO RUN
--   Easiest: paste the whole file into the Supabase dashboard SQL editor.
--   (It connects as `postgres`; SET LOCAL ROLE works there, and the closing
--   ROLLBACK leaves nothing behind.)
--   Locally: `supabase db reset` then run this file, once Docker is available.
--
-- One transaction, rolled back at the end. Fixture ids are fixed literals
-- because SET LOCAL takes a literal and cannot interpolate.

BEGIN;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.brands WHERE id = '00000000-0000-4000-8000-00000000bacc'::uuid)
     OR EXISTS (SELECT 1 FROM public.user_roles WHERE user_id IN (
          '00000000-0000-4000-8000-0000000cae01'::uuid,
          '00000000-0000-4000-8000-0000000cae02'::uuid,
          '00000000-0000-4000-8000-0000000cae03'::uuid)) THEN
    RAISE EXCEPTION 'ABORT: regression fixture ids already present; refusing to run';
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- Fixture: one brand, one location, Owner + Manager + Receptionist, one service
-- ---------------------------------------------------------------------------

INSERT INTO public.brands (id, owner_user_id, name, slug, plan,
                           max_locations, max_staff_accounts, subscription_status, billing_cycle)
VALUES ('00000000-0000-4000-8000-00000000bacc'::uuid,
        '00000000-0000-4000-8000-0000000cae01'::uuid,
        'ZZ package-catalogue regression fixture',
        'zz-package-catalogue-regression-fixture',
        'enterprise', 999, 999, 'trial', 'monthly');

INSERT INTO public.locations (id, brand_id, name)
VALUES ('00000000-0000-4000-8000-0000000cae10'::uuid,
        '00000000-0000-4000-8000-00000000bacc'::uuid, 'ZZ Package Branch');

INSERT INTO public.profiles (id, full_name) VALUES
  ('00000000-0000-4000-8000-0000000cae01'::uuid, 'ZZ Pkg Owner'),
  ('00000000-0000-4000-8000-0000000cae02'::uuid, 'ZZ Pkg Manager'),
  ('00000000-0000-4000-8000-0000000cae03'::uuid, 'ZZ Pkg Receptionist');

INSERT INTO public.user_roles (user_id, role, brand_id, location_id) VALUES
  ('00000000-0000-4000-8000-0000000cae01'::uuid, 'owner',        '00000000-0000-4000-8000-00000000bacc'::uuid, NULL),
  ('00000000-0000-4000-8000-0000000cae02'::uuid, 'manager',      '00000000-0000-4000-8000-00000000bacc'::uuid, '00000000-0000-4000-8000-0000000cae10'::uuid),
  ('00000000-0000-4000-8000-0000000cae03'::uuid, 'receptionist', '00000000-0000-4000-8000-00000000bacc'::uuid, '00000000-0000-4000-8000-0000000cae10'::uuid);

INSERT INTO public.services (id, brand_id, name, duration_minutes, default_price)
VALUES ('00000000-0000-4000-8000-0000000cae5e'::uuid,
        '00000000-0000-4000-8000-00000000bacc'::uuid, 'ZZ Package Service', 30, 100);

-- A catalogue entry that already exists, seeded as the migration role. The
-- Manager assertions need something real to try to read, edit and delete.
INSERT INTO public.package_types (id, brand_id, name, price, currency, expiry_months, status)
VALUES ('00000000-0000-4000-8000-0000000cae71'::uuid,
        '00000000-0000-4000-8000-00000000bacc'::uuid,
        'ZZ Seeded Package', 500.00, 'QAR', 6, 'active');

INSERT INTO public.package_services (package_type_id, service_id, included_count)
VALUES ('00000000-0000-4000-8000-0000000cae71'::uuid,
        '00000000-0000-4000-8000-0000000cae5e'::uuid, 3);

-- ---------------------------------------------------------------------------
-- A — MANAGER. Reads the catalogue, writes nothing.
-- ---------------------------------------------------------------------------

SET LOCAL request.jwt.claims = '{"sub":"00000000-0000-4000-8000-0000000cae02","role":"authenticated"}';
SET LOCAL ROLE authenticated;

DO $$
DECLARE
  v_brand   uuid := '00000000-0000-4000-8000-00000000bacc'::uuid;
  v_type    uuid := '00000000-0000-4000-8000-0000000cae71'::uuid;
  v_svc     uuid := '00000000-0000-4000-8000-0000000cae5e'::uuid;
  v_seen    int;
  v_rows    int;
  v_blocked int := 0;
BEGIN
  -- PRECONDITION. The Manager must genuinely reach the catalogue, or the
  -- refusals below prove nothing — a missing GRANT would look identical.
  SELECT count(*) INTO v_seen FROM public.package_types WHERE id = v_type;
  IF v_seen <> 1 THEN
    RAISE EXCEPTION 'ABORT: Manager cannot SELECT the catalogue; the write assertions would be meaningless';
  END IF;
  RAISE NOTICE 'precondition OK — Manager reads the catalogue (this is what the UI card now surfaces)';

  -- The line items must be readable too, or the read-only card cannot show
  -- what is inside a package.
  SELECT count(*) INTO v_seen FROM public.package_services WHERE package_type_id = v_type;
  IF v_seen <> 1 THEN
    RAISE EXCEPTION 'ABORT: Manager cannot SELECT package_services; the catalogue card would render empty contents';
  END IF;
  RAISE NOTICE 'precondition OK — Manager reads package contents';

  -- 1. INSERT a new package type. Raises: WITH CHECK is violated.
  BEGIN
    INSERT INTO public.package_types (brand_id, name, price, currency, expiry_months, status)
    VALUES (v_brand, 'ZZ Manager Should Not Create', 999.00, 'QAR', 12, 'active');
    RAISE EXCEPTION 'FAIL: a Manager created a package_type';
  EXCEPTION WHEN insufficient_privilege THEN v_blocked := v_blocked + 1;
  END;

  -- 2. Add a service line to the Owner's existing package. Blocked separately,
  --    because changing what a package contains is as consequential as
  --    creating one and is governed by its own policy.
  BEGIN
    INSERT INTO public.package_services (package_type_id, service_id, included_count)
    VALUES (v_type, v_svc, 99);
    RAISE EXCEPTION 'FAIL: a Manager added a line to an existing package';
  EXCEPTION WHEN insufficient_privilege THEN v_blocked := v_blocked + 1;
  END;

  IF v_blocked <> 2 THEN
    RAISE EXCEPTION 'FAIL: expected 2 blocked INSERTs, got %', v_blocked;
  END IF;
  RAISE NOTICE 'PASS — Manager INSERT refused on package_types and package_services';

  -- 3. Repricing. Quiet, not loud: USING hides the row for UPDATE, so this
  --    affects zero rows rather than raising.
  UPDATE public.package_types SET price = 1.00 WHERE id = v_type;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 0 THEN
    RAISE EXCEPTION 'FAIL: a Manager repriced a package (% rows)', v_rows;
  END IF;

  -- 4. Withdrawing / re-listing — the action the UI removed from the card.
  UPDATE public.package_types SET status = 'inactive' WHERE id = v_type;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 0 THEN
    RAISE EXCEPTION 'FAIL: a Manager withdrew a package (% rows)', v_rows;
  END IF;

  -- 5. Deletion.
  DELETE FROM public.package_types WHERE id = v_type;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 0 THEN
    RAISE EXCEPTION 'FAIL: a Manager deleted a package (% rows)', v_rows;
  END IF;
  RAISE NOTICE 'PASS — Manager UPDATE/DELETE affected zero rows';

  -- 6. Nothing actually moved.
  PERFORM 1 FROM public.package_types
   WHERE id = v_type AND price = 500.00 AND status = 'active' AND name = 'ZZ Seeded Package';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'FAIL: the seeded package changed despite every write being refused';
  END IF;

  SELECT count(*) INTO v_seen FROM public.package_types WHERE brand_id = v_brand;
  IF v_seen <> 1 THEN
    RAISE EXCEPTION 'FAIL: catalogue size changed under a Manager (now % rows)', v_seen;
  END IF;
  RAISE NOTICE 'PASS — catalogue byte-for-byte unchanged after a Manager tried everything';
END $$;

RESET ROLE;

-- ---------------------------------------------------------------------------
-- B — RECEPTIONIST. Same refusals.
-- ---------------------------------------------------------------------------

SET LOCAL request.jwt.claims = '{"sub":"00000000-0000-4000-8000-0000000cae03","role":"authenticated"}';
SET LOCAL ROLE authenticated;

DO $$
DECLARE
  v_brand uuid := '00000000-0000-4000-8000-00000000bacc'::uuid;
  v_type  uuid := '00000000-0000-4000-8000-0000000cae71'::uuid;
  v_rows  int;
BEGIN
  BEGIN
    INSERT INTO public.package_types (brand_id, name, price, currency, status)
    VALUES (v_brand, 'ZZ Receptionist Should Not Create', 50.00, 'QAR', 'active');
    RAISE EXCEPTION 'FAIL: a Receptionist created a package_type';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  UPDATE public.package_types SET price = 2.00 WHERE id = v_type;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 0 THEN
    RAISE EXCEPTION 'FAIL: a Receptionist repriced a package';
  END IF;
  RAISE NOTICE 'PASS — Receptionist refused create and reprice';

  -- Worth recording rather than asserting away: RLS *does* let a Receptionist
  -- read package_types, because `package_types_read` admits any brand member.
  -- The page chooses not to show them the catalogue card. That is a UI
  -- decision, not a database boundary, and §15 records it as such — so if the
  -- card is ever shown to Receptionists it needs no policy change.
  PERFORM 1 FROM public.package_types WHERE id = v_type;
  IF FOUND THEN
    RAISE NOTICE 'NOTE — Receptionist CAN read package_types at the DB level; the UI hides it by choice';
  END IF;
END $$;

RESET ROLE;

-- ---------------------------------------------------------------------------
-- C — OWNER. The positive control.
--
-- Without this, a policy of `USING (false)` would satisfy every assertion above
-- while making the catalogue uncreatable by anyone. "Nobody can write" and
-- "only the Owner can write" are indistinguishable from refusals alone.
-- ---------------------------------------------------------------------------

SET LOCAL request.jwt.claims = '{"sub":"00000000-0000-4000-8000-0000000cae01","role":"authenticated"}';
SET LOCAL ROLE authenticated;

DO $$
DECLARE
  v_brand uuid := '00000000-0000-4000-8000-00000000bacc'::uuid;
  v_type  uuid := '00000000-0000-4000-8000-0000000cae71'::uuid;
  v_svc   uuid := '00000000-0000-4000-8000-0000000cae5e'::uuid;
  v_new   uuid;
  v_rows  int;
BEGIN
  INSERT INTO public.package_types (brand_id, name, price, currency, expiry_months, status)
  VALUES (v_brand, 'ZZ Owner Created', 300.00, 'QAR', 3, 'active')
  RETURNING id INTO v_new;
  IF v_new IS NULL THEN
    RAISE EXCEPTION 'FAIL: the Owner could not create a package_type — the policy blocks everybody';
  END IF;

  INSERT INTO public.package_services (package_type_id, service_id, included_count)
  VALUES (v_new, v_svc, 2);

  UPDATE public.package_types SET status = 'inactive' WHERE id = v_type;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 1 THEN
    RAISE EXCEPTION 'FAIL: the Owner could not withdraw a package (% rows)', v_rows;
  END IF;

  RAISE NOTICE 'PASS — Owner creates, fills and withdraws freely (positive control holds)';
  RAISE NOTICE 'ALL REGRESSION CHECKS PASSED';
END $$;

RESET ROLE;
ROLLBACK;
