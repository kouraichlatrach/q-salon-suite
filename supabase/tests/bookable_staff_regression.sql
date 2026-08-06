-- REGRESSION TEST — only a Staff-role account may be assigned as bookable staff,
-- and the roles that do the booking must be able to see those staff.
--
-- Two halves, because shipping only the first would have been worse than
-- shipping neither:
--
--   A. enforce_bookable_staff_role rejects Owner / Manager / Receptionist on
--      appointments.staff_user_id and staff_services.user_id, while leaving
--      genuine Staff assignments and unrelated updates alone.
--
--   B. A Receptionist can actually SELECT the staff rows and profiles the
--      picker needs. Before the sibling migration they could not: RLS returned
--      only their own row, the picker listed only themselves, and every
--      appointment a Receptionist booked was assigned to a Receptionist. Half A
--      without half B does not fix that — it just empties the dropdown.
--
-- Like billing_guard_regression.sql, half B impersonates the real role:
--     SET LOCAL request.jwt.claims = '{"sub": ..., "role": "authenticated"}'
--     SET LOCAL ROLE authenticated
-- Reading the policy SQL is not enough — a policy that grants the wrong party,
-- or nobody, looks identical to one that works until a real session runs.
--
-- HOW TO RUN
--   Easiest: paste the whole file into the Supabase dashboard SQL editor.
--   Locally: `supabase db reset` then run this file.
--
-- One transaction, rolled back at the end. Fixture ids are fixed literals
-- because SET LOCAL cannot interpolate.

BEGIN;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.brands WHERE id = '00000000-0000-4000-8000-0000000b0057')
     OR EXISTS (SELECT 1 FROM public.user_roles WHERE user_id IN (
          '00000000-0000-4000-8000-0000000b0001',
          '00000000-0000-4000-8000-0000000b0002',
          '00000000-0000-4000-8000-0000000b0003',
          '00000000-0000-4000-8000-0000000b0004')) THEN
    RAISE EXCEPTION 'ABORT: regression fixture ids already present; refusing to run';
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- Fixture: one brand, one location, one of each role, one service, one client
-- ---------------------------------------------------------------------------

INSERT INTO public.brands (id, owner_user_id, name, slug, plan,
                           max_locations, max_staff_accounts, subscription_status, billing_cycle)
VALUES ('00000000-0000-4000-8000-0000000b0057',
        '00000000-0000-4000-8000-0000000b0001',
        'ZZ bookable-staff regression fixture',
        'zz-bookable-staff-regression-fixture',
        'enterprise', 999, 999, 'trial', 'monthly');

INSERT INTO public.locations (id, brand_id, name)
VALUES ('00000000-0000-4000-8000-0000000b010c',
        '00000000-0000-4000-8000-0000000b0057', 'ZZ Regression Branch');

INSERT INTO public.profiles (id, full_name) VALUES
  ('00000000-0000-4000-8000-0000000b0001', 'ZZ Owner'),
  ('00000000-0000-4000-8000-0000000b0002', 'ZZ Manager'),
  ('00000000-0000-4000-8000-0000000b0003', 'ZZ Receptionist'),
  ('00000000-0000-4000-8000-0000000b0004', 'ZZ Staff');

INSERT INTO public.user_roles (user_id, role, brand_id, location_id) VALUES
  ('00000000-0000-4000-8000-0000000b0001', 'owner',        '00000000-0000-4000-8000-0000000b0057', NULL),
  ('00000000-0000-4000-8000-0000000b0002', 'manager',      '00000000-0000-4000-8000-0000000b0057', '00000000-0000-4000-8000-0000000b010c'),
  ('00000000-0000-4000-8000-0000000b0003', 'receptionist', '00000000-0000-4000-8000-0000000b0057', '00000000-0000-4000-8000-0000000b010c'),
  ('00000000-0000-4000-8000-0000000b0004', 'staff',        '00000000-0000-4000-8000-0000000b0057', '00000000-0000-4000-8000-0000000b010c');

INSERT INTO public.services (id, brand_id, name, duration_minutes, default_price)
VALUES ('00000000-0000-4000-8000-0000000b5e12',
        '00000000-0000-4000-8000-0000000b0057', 'ZZ Regression Service', 30, 100);

INSERT INTO public.clients (id, brand_id, name, phone)
VALUES ('00000000-0000-4000-8000-0000000bc11e',
        '00000000-0000-4000-8000-0000000b0057', 'ZZ Regression Client', '+97400000000');

-- ---------------------------------------------------------------------------
-- HALF A — the guard. Runs as the migration role, which is the strongest
-- possible caller: if it is blocked here it is blocked everywhere.
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  v_brand   uuid := '00000000-0000-4000-8000-0000000b0057';
  v_loc     uuid := '00000000-0000-4000-8000-0000000b010c';
  v_svc     uuid := '00000000-0000-4000-8000-0000000b5e12';
  v_client  uuid := '00000000-0000-4000-8000-0000000bc11e';
  v_staff   uuid := '00000000-0000-4000-8000-0000000b0004';
  v_blocked int := 0;
  v_appt    uuid;
  v_who     uuid;
  v_label   text;
BEGIN
  -- Every non-Staff role must be refused on appointments.staff_user_id.
  FOREACH v_who IN ARRAY ARRAY[
    '00000000-0000-4000-8000-0000000b0001'::uuid,  -- owner
    '00000000-0000-4000-8000-0000000b0002'::uuid,  -- manager
    '00000000-0000-4000-8000-0000000b0003'::uuid   -- receptionist
  ] LOOP
    SELECT full_name INTO v_label FROM public.profiles WHERE id = v_who;
    BEGIN
      INSERT INTO public.appointments (brand_id, location_id, client_id, staff_user_id,
                                       service_id, starts_at, ends_at, price)
      VALUES (v_brand, v_loc, v_client, v_who, v_svc,
              '2027-11-03 04:00+00', '2027-11-03 04:30+00', 100);
      RAISE EXCEPTION 'FAIL: % was assignable as appointments.staff_user_id', v_label;
    EXCEPTION WHEN raise_exception THEN
      IF SQLERRM LIKE 'FAIL:%' THEN RAISE; END IF;
      IF SQLERRM NOT LIKE '%not_bookable_staff%' THEN
        RAISE EXCEPTION 'FAIL: % rejected for the wrong reason: %', v_label, SQLERRM;
      END IF;
      v_blocked := v_blocked + 1;
    END;

    BEGIN
      INSERT INTO public.staff_services (brand_id, user_id, service_id)
      VALUES (v_brand, v_who, v_svc);
      RAISE EXCEPTION 'FAIL: % was assignable as staff_services.user_id', v_label;
    EXCEPTION WHEN raise_exception THEN
      IF SQLERRM LIKE 'FAIL:%' THEN RAISE; END IF;
      IF SQLERRM NOT LIKE '%not_bookable_staff%' THEN
        RAISE EXCEPTION 'FAIL: % rejected for the wrong reason: %', v_label, SQLERRM;
      END IF;
      v_blocked := v_blocked + 1;
    END;
  END LOOP;

  IF v_blocked <> 6 THEN
    RAISE EXCEPTION 'FAIL: expected 6 blocked assignments, got %', v_blocked;
  END IF;
  RAISE NOTICE 'PASS — owner/manager/receptionist rejected on both tables (6/6)';

  -- Control: the guard must not block a genuine Staff assignment, or it has
  -- simply broken booking rather than constrained it.
  INSERT INTO public.appointments (brand_id, location_id, client_id, staff_user_id,
                                   service_id, starts_at, ends_at, price)
  VALUES (v_brand, v_loc, v_client, v_staff, v_svc,
          '2027-11-03 04:00+00', '2027-11-03 04:30+00', 100)
  RETURNING id INTO v_appt;
  INSERT INTO public.staff_services (brand_id, user_id, service_id)
  VALUES (v_brand, v_staff, v_svc);
  RAISE NOTICE 'PASS — a real Staff account is still assignable on both tables';

  -- Re-assigning an existing appointment away to a non-Staff account.
  BEGIN
    UPDATE public.appointments SET staff_user_id = '00000000-0000-4000-8000-0000000b0002'
     WHERE id = v_appt;
    RAISE EXCEPTION 'FAIL: UPDATE re-assigned an appointment to a Manager';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM LIKE 'FAIL:%' THEN RAISE; END IF;
    IF SQLERRM NOT LIKE '%not_bookable_staff%' THEN
      RAISE EXCEPTION 'FAIL: UPDATE rejected for the wrong reason: %', SQLERRM;
    END IF;
  END;
  RAISE NOTICE 'PASS — UPDATE cannot re-assign to a non-Staff account';

  -- The other half of that rule (bug class 4): an UPDATE that does not touch
  -- the assignment must still succeed. A guard that re-validates an untouched
  -- column makes every legacy row impossible to complete or cancel.
  UPDATE public.appointments SET status = 'completed' WHERE id = v_appt;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'FAIL: an unrelated UPDATE was blocked by the guard';
  END IF;
  RAISE NOTICE 'PASS — unrelated updates to the same row are unaffected';
END $$;

-- ---------------------------------------------------------------------------
-- HALF B — visibility. A Receptionist must be able to see Staff, and only Staff.
-- ---------------------------------------------------------------------------

SET LOCAL request.jwt.claims = '{"sub":"00000000-0000-4000-8000-0000000b0003","role":"authenticated"}';
SET LOCAL ROLE authenticated;

DO $$
DECLARE
  v_loc         uuid := '00000000-0000-4000-8000-0000000b010c';
  v_staff_seen  int;
  v_others_seen int;
  v_name        text;
BEGIN
  -- This is the exact shape the appointments picker runs.
  SELECT count(*) INTO v_staff_seen
  FROM public.user_roles
  WHERE brand_id = '00000000-0000-4000-8000-0000000b0057'
    AND role = 'staff' AND location_id = v_loc AND user_id IS NOT NULL;

  IF v_staff_seen < 1 THEN
    RAISE EXCEPTION 'FAIL: a Receptionist sees no Staff rows — the booking dropdown would be empty';
  END IF;
  RAISE NOTICE 'PASS — Receptionist sees % Staff row(s) at their location', v_staff_seen;

  -- and the name, or the dropdown renders blank entries
  SELECT full_name INTO v_name FROM public.profiles
   WHERE id = '00000000-0000-4000-8000-0000000b0004';
  IF v_name IS DISTINCT FROM 'ZZ Staff' THEN
    RAISE EXCEPTION 'FAIL: a Receptionist cannot read the Staff member''s profile name';
  END IF;
  RAISE NOTICE 'PASS — Receptionist can read the Staff profile name';

  -- The grant must not be a back door onto everyone else's role rows.
  SELECT count(*) INTO v_others_seen
  FROM public.user_roles
  WHERE brand_id = '00000000-0000-4000-8000-0000000b0057'
    AND role <> 'staff'
    AND user_id <> '00000000-0000-4000-8000-0000000b0003';  -- their own row is allowed
  IF v_others_seen <> 0 THEN
    RAISE EXCEPTION 'FAIL: a Receptionist can enumerate % non-Staff role row(s)', v_others_seen;
  END IF;
  RAISE NOTICE 'PASS — Receptionist still cannot see Owner/Manager/other Receptionist rows';

  RAISE NOTICE 'ALL REGRESSION CHECKS PASSED';
END $$;

RESET ROLE;
ROLLBACK;
