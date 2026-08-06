-- NEGATIVE CONTROL for bookable_staff_regression.sql
--
-- The companion test asserts the guard blocks and the policies grant. This file
-- asserts the opposite thing, which is the part that actually makes the first
-- file worth keeping: that its assertions FAIL when the code under test is
-- removed. A test that passes whether or not the feature exists is decoration —
-- billing_guard_regression.sql says so in its own header, and the guard it
-- covers is the reason: that guard shipped, applied cleanly, looked correct in
-- review, and blocked nothing at all.
--
-- Method: inside one transaction, remove the trigger and the two policies, then
-- assert the protections are gone. Success means the regression test has teeth.
-- An error means some assertion in the regression test would pass even with the
-- feature deleted — i.e. it is testing nothing, and you want to know that.
--
-- READ THIS BEFORE RUNNING
--   * It DROPs a trigger and two RLS policies. Postgres DDL is transactional
--     and the final ROLLBACK puts all three back, including if the script errors
--     out partway or the connection drops mid-transaction.
--   * While it runs it holds ACCESS EXCLUSIVE locks on appointments,
--     staff_services, user_roles and profiles. On a project with live traffic
--     that blocks reads and writes for the duration. This is a test-project
--     tool; do not run it against a database with real customers on it.
--   * The DROPs are deliberately NOT written with IF EXISTS. If an object is
--     already missing, this file should fail loudly rather than "pass" by
--     removing nothing.
--
-- AFTER RUNNING, confirm the protections came back — the whole point is that
-- this file leaves no trace:
--
--   SELECT tgname FROM pg_trigger
--    WHERE tgname = 'enforce_bookable_staff_role_trg' AND NOT tgisinternal;
--   -- expect 2 rows (appointments + staff_services)
--
--   SELECT policyname FROM pg_policies
--    WHERE policyname IN ('Booking roles view staff at their location',
--                         'Booking roles view staff profiles');
--   -- expect 2 rows
--
-- HOW TO RUN
--   Paste the whole file into the Supabase dashboard SQL editor. "Success. No
--   rows returned." means every negative control held.

BEGIN;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.brands WHERE id = '00000000-0000-4000-8000-0000000c0057')
     OR EXISTS (SELECT 1 FROM public.user_roles WHERE user_id IN (
          '00000000-0000-4000-8000-0000000c0001',
          '00000000-0000-4000-8000-0000000c0003',
          '00000000-0000-4000-8000-0000000c0004')) THEN
    RAISE EXCEPTION 'ABORT: negative-control fixture ids already present; refusing to run';
  END IF;
END $$;

-- Same shape as the regression fixture, distinct ids so the two files can never
-- collide if someone runs them in the same session.
INSERT INTO public.brands (id, owner_user_id, name, slug, plan,
                           max_locations, max_staff_accounts, subscription_status, billing_cycle)
VALUES ('00000000-0000-4000-8000-0000000c0057',
        '00000000-0000-4000-8000-0000000c0001',
        'ZZ bookable-staff negative control',
        'zz-bookable-staff-negative-control',
        'enterprise', 999, 999, 'trial', 'monthly');

INSERT INTO public.locations (id, brand_id, name)
VALUES ('00000000-0000-4000-8000-0000000c010c',
        '00000000-0000-4000-8000-0000000c0057', 'ZZ Negative Branch');

INSERT INTO public.profiles (id, full_name) VALUES
  ('00000000-0000-4000-8000-0000000c0001', 'ZZ NC Owner'),
  ('00000000-0000-4000-8000-0000000c0003', 'ZZ NC Receptionist'),
  ('00000000-0000-4000-8000-0000000c0004', 'ZZ NC Staff');

INSERT INTO public.user_roles (user_id, role, brand_id, location_id) VALUES
  ('00000000-0000-4000-8000-0000000c0001', 'owner',        '00000000-0000-4000-8000-0000000c0057', NULL),
  ('00000000-0000-4000-8000-0000000c0003', 'receptionist', '00000000-0000-4000-8000-0000000c0057', '00000000-0000-4000-8000-0000000c010c'),
  ('00000000-0000-4000-8000-0000000c0004', 'staff',        '00000000-0000-4000-8000-0000000c0057', '00000000-0000-4000-8000-0000000c010c');

INSERT INTO public.services (id, brand_id, name, duration_minutes, default_price)
VALUES ('00000000-0000-4000-8000-0000000c5e12',
        '00000000-0000-4000-8000-0000000c0057', 'ZZ NC Service', 30, 100);

INSERT INTO public.clients (id, brand_id, name, phone)
VALUES ('00000000-0000-4000-8000-0000000cc11e',
        '00000000-0000-4000-8000-0000000c0057', 'ZZ NC Client', '+97400000001');

-- ---------------------------------------------------------------------------
-- CONTROL 1 — the guard is what rejects an Owner, not something incidental
--
-- The regression test asserts an Owner cannot be assigned. That would also
-- "pass" if the insert were failing on a foreign key, the overlap trigger, a
-- NOT NULL, or a typo in the fixture. Removing the trigger and watching the
-- same insert succeed is what distinguishes "the guard blocked it" from
-- "something blocked it".
-- ---------------------------------------------------------------------------

DROP TRIGGER enforce_bookable_staff_role_trg ON public.appointments;
DROP TRIGGER enforce_bookable_staff_role_trg ON public.staff_services;

DO $$
DECLARE
  v_appt uuid;
  v_ss   uuid;
BEGIN
  BEGIN
    INSERT INTO public.appointments (brand_id, location_id, client_id, staff_user_id,
                                     service_id, starts_at, ends_at, price)
    VALUES ('00000000-0000-4000-8000-0000000c0057',
            '00000000-0000-4000-8000-0000000c010c',
            '00000000-0000-4000-8000-0000000cc11e',
            '00000000-0000-4000-8000-0000000c0001',   -- the Owner
            '00000000-0000-4000-8000-0000000c5e12',
            '2027-11-03 04:00+00', '2027-11-03 04:30+00', 100)
    RETURNING id INTO v_appt;
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION
      'NO TEETH: with the trigger dropped, assigning an Owner STILL failed (%). The regression test''s rejection was caused by something other than the guard.', SQLERRM;
  END;
  RAISE NOTICE 'CONTROL 1a OK — trigger removed, Owner assignment succeeds. The guard is the thing doing the blocking.';

  BEGIN
    INSERT INTO public.staff_services (brand_id, user_id, service_id)
    VALUES ('00000000-0000-4000-8000-0000000c0057',
            '00000000-0000-4000-8000-0000000c0001',
            '00000000-0000-4000-8000-0000000c5e12')
    RETURNING id INTO v_ss;
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION
      'NO TEETH: with the trigger dropped, staff_services STILL rejected an Owner (%).', SQLERRM;
  END;
  RAISE NOTICE 'CONTROL 1b OK — trigger removed, staff_services accepts an Owner.';
END $$;

-- ---------------------------------------------------------------------------
-- CONTROL 2 — the new policies are what make a Receptionist's picker work
--
-- Half B of the regression test asserts a Receptionist can see Staff rows and
-- Staff names. If any pre-existing policy already granted that, the new
-- policies would be redundant and Half B would pass without them. This proves
-- they are load-bearing: with them gone, the Receptionist sees nothing.
-- ---------------------------------------------------------------------------

DROP POLICY "Booking roles view staff at their location" ON public.user_roles;
DROP POLICY "Booking roles view staff profiles" ON public.profiles;

SET LOCAL request.jwt.claims = '{"sub":"00000000-0000-4000-8000-0000000c0003","role":"authenticated"}';
SET LOCAL ROLE authenticated;

DO $$
DECLARE
  v_staff_seen int;
  v_name       text;
  v_own_seen   int;
BEGIN
  -- Precondition: the impersonation has to be real. If auth.uid() is not
  -- resolving, the Receptionist would see nothing for a trivial reason and both
  -- assertions below would "pass" while proving nothing at all.
  SELECT count(*) INTO v_own_seen
  FROM public.user_roles
  WHERE user_id = '00000000-0000-4000-8000-0000000c0003';
  IF v_own_seen <> 1 THEN
    RAISE EXCEPTION
      'ABORT: impersonated Receptionist cannot even see their own role row (got %). auth.uid() is not resolving, so the controls below would be meaningless.', v_own_seen;
  END IF;
  RAISE NOTICE 'precondition OK — impersonation is live, own row visible';

  -- The exact query the appointments picker runs.
  SELECT count(*) INTO v_staff_seen
  FROM public.user_roles
  WHERE brand_id = '00000000-0000-4000-8000-0000000c0057'
    AND role = 'staff'
    AND location_id = '00000000-0000-4000-8000-0000000c010c'
    AND user_id IS NOT NULL;

  IF v_staff_seen <> 0 THEN
    RAISE EXCEPTION
      'NO TEETH: with the policy dropped, a Receptionist still sees % Staff row(s). Some other policy already granted this, so the regression test would pass with the fix removed.', v_staff_seen;
  END IF;
  RAISE NOTICE 'CONTROL 2a OK — policy removed, Receptionist sees 0 Staff rows. The dropdown really does depend on it.';

  SELECT full_name INTO v_name FROM public.profiles
   WHERE id = '00000000-0000-4000-8000-0000000c0004';
  IF v_name IS NOT NULL THEN
    RAISE EXCEPTION
      'NO TEETH: with the policy dropped, a Receptionist still reads the Staff profile name (%).', v_name;
  END IF;
  RAISE NOTICE 'CONTROL 2b OK — policy removed, Staff profile name is invisible.';

  RAISE NOTICE 'ALL NEGATIVE CONTROLS HELD — the regression test fails when the feature is removed, which is what makes its passing meaningful.';
END $$;

RESET ROLE;
ROLLBACK;
