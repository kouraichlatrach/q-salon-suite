-- REGRESSION TEST — staff profile: PII tiering, the photo carve-out, and the
-- atomicity of transfer_staff_location.
--
-- Everything here needs a real impersonated session, which is why it is a .sql
-- file rather than part of the Node verification: PostgREST's service_role key
-- carries no `sub`, so auth.uid() is NULL and neither the RLS policies nor the
-- RPC's authorisation branches can be exercised through it. Reading the policy
-- SQL is not a substitute — guard_brand_billing_columns shipped, read correctly,
-- and blocked nothing.
--
-- Covers:
--   A. Receptionist and Staff cannot read staff_personal_details.
--   B. Staff CAN read the photo row while the PII stays hidden — the whole
--      reason the photo lives in its own table.
--   C. Manager sees PII for their own location's staff, not another branch's.
--   D. transfer_staff_location does all three writes, and a Manager cannot push
--      someone to a location they do not run.
--   E. A failure part-way through the transfer leaves NOTHING behind.
--
-- HOW TO RUN
--   Paste into the Supabase dashboard SQL editor. "Success. No rows returned."
--   means every assertion held. One transaction, rolled back.

BEGIN;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.brands WHERE id = '00000000-0000-4000-8000-0000000d0057') THEN
    RAISE EXCEPTION 'ABORT: staff-profile fixture ids already present; refusing to run';
  END IF;
END $$;

-- Fixture: one brand, TWO locations, owner + two managers + receptionist + two staff.
INSERT INTO public.brands (id, owner_user_id, name, slug, plan, max_locations,
                           max_staff_accounts, subscription_status, billing_cycle)
VALUES ('00000000-0000-4000-8000-0000000d0057','00000000-0000-4000-8000-0000000d0001',
        'ZZ staff-profile fixture','zz-staff-profile-fixture','enterprise',999,999,'trial','monthly');

INSERT INTO public.locations (id, brand_id, name) VALUES
  ('00000000-0000-4000-8000-0000000d0a01','00000000-0000-4000-8000-0000000d0057','ZZ Branch A'),
  ('00000000-0000-4000-8000-0000000d0b02','00000000-0000-4000-8000-0000000d0057','ZZ Branch B');

INSERT INTO public.profiles (id, full_name) VALUES
  ('00000000-0000-4000-8000-0000000d0001','ZZ Owner'),
  ('00000000-0000-4000-8000-0000000d0002','ZZ Manager A'),
  ('00000000-0000-4000-8000-0000000d0003','ZZ Manager B'),
  ('00000000-0000-4000-8000-0000000d0004','ZZ Receptionist A'),
  ('00000000-0000-4000-8000-0000000d0005','ZZ Staff A'),
  ('00000000-0000-4000-8000-0000000d0006','ZZ Staff B');

INSERT INTO public.user_roles (user_id, role, brand_id, location_id) VALUES
  ('00000000-0000-4000-8000-0000000d0001','owner',       '00000000-0000-4000-8000-0000000d0057', NULL),
  ('00000000-0000-4000-8000-0000000d0002','manager',     '00000000-0000-4000-8000-0000000d0057','00000000-0000-4000-8000-0000000d0a01'),
  ('00000000-0000-4000-8000-0000000d0003','manager',     '00000000-0000-4000-8000-0000000d0057','00000000-0000-4000-8000-0000000d0b02'),
  ('00000000-0000-4000-8000-0000000d0004','receptionist','00000000-0000-4000-8000-0000000d0057','00000000-0000-4000-8000-0000000d0a01'),
  ('00000000-0000-4000-8000-0000000d0005','staff',       '00000000-0000-4000-8000-0000000d0057','00000000-0000-4000-8000-0000000d0a01'),
  ('00000000-0000-4000-8000-0000000d0006','staff',       '00000000-0000-4000-8000-0000000d0057','00000000-0000-4000-8000-0000000d0b02');

INSERT INTO public.staff_personal_details (user_id, national_id, home_address, nationality)
VALUES ('00000000-0000-4000-8000-0000000d0005','28912345678','12 ZZ Street, Doha','Qatari');

INSERT INTO public.staff_photos (user_id, brand_id, photo_path)
VALUES ('00000000-0000-4000-8000-0000000d0005',
        '00000000-0000-4000-8000-0000000d0057',
        '00000000-0000-4000-8000-0000000d0057/00000000-0000-4000-8000-0000000d0005.jpg');

INSERT INTO public.staff_location_history (user_id, location_id, brand_id, started_at)
VALUES ('00000000-0000-4000-8000-0000000d0005','00000000-0000-4000-8000-0000000d0a01',
        '00000000-0000-4000-8000-0000000d0057','2026-01-01 00:00+00');

-- ===========================================================================
-- A + B. RECEPTIONIST: no PII, but the photo is fine.
-- ===========================================================================
SET LOCAL request.jwt.claims = '{"sub":"00000000-0000-4000-8000-0000000d0004","role":"authenticated"}';
SET LOCAL ROLE authenticated;

DO $$
DECLARE v_pii int; v_photo int; v_self int;
BEGIN
  -- Precondition: impersonation is live. Without this, "sees nothing" could be
  -- an unresolved auth.uid() rather than a working policy, and every assertion
  -- below would pass for the wrong reason.
  SELECT count(*) INTO v_self FROM public.user_roles
   WHERE user_id = '00000000-0000-4000-8000-0000000d0004';
  IF v_self <> 1 THEN
    RAISE EXCEPTION 'ABORT: impersonation not live (own role rows = %)', v_self;
  END IF;

  SELECT count(*) INTO v_pii FROM public.staff_personal_details
   WHERE user_id = '00000000-0000-4000-8000-0000000d0005';
  IF v_pii <> 0 THEN
    RAISE EXCEPTION 'FAIL: a Receptionist read % personal-details row(s)', v_pii;
  END IF;
  RAISE NOTICE 'PASS — Receptionist sees 0 personal-details rows';

  SELECT count(*) INTO v_photo FROM public.staff_photos
   WHERE user_id = '00000000-0000-4000-8000-0000000d0005';
  IF v_photo <> 1 THEN
    RAISE EXCEPTION 'FAIL: a Receptionist could not see the photo row (got %)', v_photo;
  END IF;
  RAISE NOTICE 'PASS — Receptionist sees the photo';
END $$;

RESET ROLE;

-- Staff colleague: same split. This is the case the table split exists for.
SET LOCAL request.jwt.claims = '{"sub":"00000000-0000-4000-8000-0000000d0006","role":"authenticated"}';
SET LOCAL ROLE authenticated;

DO $$
DECLARE v_pii int; v_photo int;
BEGIN
  SELECT count(*) INTO v_pii FROM public.staff_personal_details;
  IF v_pii <> 0 THEN
    RAISE EXCEPTION 'FAIL: a Staff account read % personal-details row(s)', v_pii;
  END IF;
  RAISE NOTICE 'PASS — Staff colleague sees 0 personal-details rows';

  SELECT count(*) INTO v_photo FROM public.staff_photos
   WHERE user_id = '00000000-0000-4000-8000-0000000d0005';
  IF v_photo <> 1 THEN
    RAISE EXCEPTION 'FAIL: a Staff account could not see a colleague''s photo (got %)', v_photo;
  END IF;
  RAISE NOTICE 'PASS — Staff colleague sees the photo but not the PII';
END $$;

RESET ROLE;

-- ===========================================================================
-- C. MANAGERS: own location only.
-- ===========================================================================
SET LOCAL request.jwt.claims = '{"sub":"00000000-0000-4000-8000-0000000d0002","role":"authenticated"}';
SET LOCAL ROLE authenticated;
DO $$
DECLARE v int;
BEGIN
  SELECT count(*) INTO v FROM public.staff_personal_details
   WHERE user_id = '00000000-0000-4000-8000-0000000d0005';
  IF v <> 1 THEN RAISE EXCEPTION 'FAIL: Manager A cannot see their OWN location staff''s PII (got %)', v; END IF;
  RAISE NOTICE 'PASS — Manager A sees PII for their own location''s staff';
END $$;
RESET ROLE;

SET LOCAL request.jwt.claims = '{"sub":"00000000-0000-4000-8000-0000000d0003","role":"authenticated"}';
SET LOCAL ROLE authenticated;
DO $$
DECLARE v int;
BEGIN
  SELECT count(*) INTO v FROM public.staff_personal_details
   WHERE user_id = '00000000-0000-4000-8000-0000000d0005';
  IF v <> 0 THEN
    RAISE EXCEPTION 'FAIL: Manager B read PII for a stylist at another branch (got % row(s)) — the PDPPL tightening is not working', v;
  END IF;
  RAISE NOTICE 'PASS — Manager B cannot reach another branch''s PII';
END $$;
RESET ROLE;

-- ===========================================================================
-- D. TRANSFER — permissions and the three writes.
-- ===========================================================================

-- Manager B tries to pull Staff A into Branch B: allowed (INTO their own).
SET LOCAL request.jwt.claims = '{"sub":"00000000-0000-4000-8000-0000000d0003","role":"authenticated"}';
SET LOCAL ROLE authenticated;
DO $$
DECLARE r RECORD; v_open int; v_closed int; v_roster uuid;
BEGIN
  SELECT * INTO r FROM public.transfer_staff_location(
    '00000000-0000-4000-8000-0000000d0005','00000000-0000-4000-8000-0000000d0b02');
  IF NOT r.ok THEN RAISE EXCEPTION 'FAIL: manager could not pull staff INTO their own branch (%)', r.outcome; END IF;

  SELECT count(*) INTO v_open FROM public.staff_location_history
   WHERE user_id='00000000-0000-4000-8000-0000000d0005' AND ended_at IS NULL
     AND location_id='00000000-0000-4000-8000-0000000d0b02';
  SELECT count(*) INTO v_closed FROM public.staff_location_history
   WHERE user_id='00000000-0000-4000-8000-0000000d0005' AND ended_at IS NOT NULL
     AND location_id='00000000-0000-4000-8000-0000000d0a01';
  SELECT location_id INTO v_roster FROM public.user_roles
   WHERE user_id='00000000-0000-4000-8000-0000000d0005' AND role='staff';

  IF v_open <> 1   THEN RAISE EXCEPTION 'FAIL: expected 1 open row at Branch B, got %', v_open; END IF;
  IF v_closed <> 1 THEN RAISE EXCEPTION 'FAIL: the Branch A row was not closed (got %)', v_closed; END IF;
  IF v_roster <> '00000000-0000-4000-8000-0000000d0b02' THEN
    RAISE EXCEPTION 'FAIL: user_roles.location_id was not updated';
  END IF;
  RAISE NOTICE 'PASS — all three writes landed together (old closed, new open, roster moved)';

  -- Same destination again must be a no-op, not a zero-length stint.
  SELECT * INTO r FROM public.transfer_staff_location(
    '00000000-0000-4000-8000-0000000d0005','00000000-0000-4000-8000-0000000d0b02');
  IF r.ok OR r.outcome <> 'no_change' THEN
    RAISE EXCEPTION 'FAIL: repeat transfer returned ok=% outcome=%', r.ok, r.outcome;
  END IF;
  RAISE NOTICE 'PASS — repeating a transfer is a no-op';
END $$;
RESET ROLE;

-- Manager B now tries to PUSH them out to Branch A, which they do not run.
SET LOCAL request.jwt.claims = '{"sub":"00000000-0000-4000-8000-0000000d0003","role":"authenticated"}';
SET LOCAL ROLE authenticated;
DO $$
DECLARE r RECORD; v_roster uuid; v_rows int;
BEGIN
  SELECT * INTO r FROM public.transfer_staff_location(
    '00000000-0000-4000-8000-0000000d0005','00000000-0000-4000-8000-0000000d0a01');
  IF r.ok OR r.outcome <> 'not_permitted' THEN
    RAISE EXCEPTION 'FAIL: Manager B pushed staff to a branch they do not manage (ok=%, outcome=%)', r.ok, r.outcome;
  END IF;

  -- Refused is not enough — it must also have changed nothing.
  SELECT location_id INTO v_roster FROM public.user_roles
   WHERE user_id='00000000-0000-4000-8000-0000000d0005' AND role='staff';
  SELECT count(*) INTO v_rows FROM public.staff_location_history
   WHERE user_id='00000000-0000-4000-8000-0000000d0005';
  IF v_roster <> '00000000-0000-4000-8000-0000000d0b02' OR v_rows <> 2 THEN
    RAISE EXCEPTION 'FAIL: a refused transfer still mutated state (roster=%, history rows=%)', v_roster, v_rows;
  END IF;
  RAISE NOTICE 'PASS — Manager cannot push staff outside their branch, and the refusal wrote nothing';
END $$;
RESET ROLE;

-- Owner may send them anywhere.
SET LOCAL request.jwt.claims = '{"sub":"00000000-0000-4000-8000-0000000d0001","role":"authenticated"}';
SET LOCAL ROLE authenticated;
DO $$
DECLARE r RECORD;
BEGIN
  SELECT * INTO r FROM public.transfer_staff_location(
    '00000000-0000-4000-8000-0000000d0005','00000000-0000-4000-8000-0000000d0a01');
  IF NOT r.ok THEN RAISE EXCEPTION 'FAIL: Owner could not transfer (%)', r.outcome; END IF;
  RAISE NOTICE 'PASS — Owner may transfer to any branch in the brand';
END $$;
RESET ROLE;

-- ===========================================================================
-- E. ATOMICITY — a failure part-way through must leave nothing behind.
--
-- The RPC's third write is user_roles. A trigger that raises on exactly that
-- write simulates a mid-transaction failure after the two history writes have
-- already happened. If the history rows survive, the function is not atomic and
-- the roster and the timeline can disagree — the split-brain this design exists
-- to prevent.
-- ===========================================================================

CREATE OR REPLACE FUNCTION public.zz_fail_on_roster_update()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'ZZ simulated mid-transaction failure';
END $$;

CREATE TRIGGER zz_fail_roster
  BEFORE UPDATE ON public.user_roles
  FOR EACH ROW
  WHEN (OLD.user_id = '00000000-0000-4000-8000-0000000d0005')
  EXECUTE FUNCTION public.zz_fail_on_roster_update();

SET LOCAL request.jwt.claims = '{"sub":"00000000-0000-4000-8000-0000000d0001","role":"authenticated"}';
SET LOCAL ROLE authenticated;
DO $$
DECLARE
  v_before_rows int; v_after_rows int;
  v_before_open uuid; v_after_open uuid;
  v_raised boolean := false;
BEGIN
  SELECT count(*) INTO v_before_rows FROM public.staff_location_history
   WHERE user_id='00000000-0000-4000-8000-0000000d0005';
  SELECT location_id INTO v_before_open FROM public.staff_location_history
   WHERE user_id='00000000-0000-4000-8000-0000000d0005' AND ended_at IS NULL;

  BEGIN
    PERFORM public.transfer_staff_location(
      '00000000-0000-4000-8000-0000000d0005','00000000-0000-4000-8000-0000000d0b02');
  EXCEPTION WHEN OTHERS THEN
    v_raised := true;
  END;

  IF NOT v_raised THEN
    RAISE EXCEPTION 'ABORT: the simulated failure did not fire; this control proves nothing';
  END IF;

  SELECT count(*) INTO v_after_rows FROM public.staff_location_history
   WHERE user_id='00000000-0000-4000-8000-0000000d0005';
  SELECT location_id INTO v_after_open FROM public.staff_location_history
   WHERE user_id='00000000-0000-4000-8000-0000000d0005' AND ended_at IS NULL;

  IF v_after_rows <> v_before_rows THEN
    RAISE EXCEPTION 'FAIL: % history row(s) survived a failed transfer (was %)', v_after_rows, v_before_rows;
  END IF;
  IF v_after_open IS DISTINCT FROM v_before_open THEN
    RAISE EXCEPTION 'FAIL: the open location changed despite the transfer failing';
  END IF;
  RAISE NOTICE 'PASS — a failure at the third write rolled back the first two; no orphan history';
  RAISE NOTICE 'ALL STAFF-PROFILE REGRESSION CHECKS PASSED';
END $$;
RESET ROLE;

DROP TRIGGER zz_fail_roster ON public.user_roles;
DROP FUNCTION public.zz_fail_on_roster_update();

ROLLBACK;
