-- ===========================================================================
-- FULL TEST-DATA RESET — Q-Salon Suite
--
-- ⚠️  THIS DELETES EVERY ROW OF REAL DATA, INCLUDING THE "beauty" BRAND AND
--     EVERY auth.users LOGIN. THERE IS NO UNDO. Take a backup / confirm PITR
--     before running Stage 1.
--
-- ⚠️  YOU WILL BE LOGGED OUT OF THE APP. Deleting auth.users removes your own
--     application login. Supabase *dashboard* access is unaffected (separate
--     account), but you cannot sign in to /app again until Stage 2 has run and
--     created the new owner accounts.
--
-- ⚠️  platform_admins IS EMPTIED. Nobody can reach /admin until you re-insert
--     yourself. See the note at the end of Stage 2.
--
-- Run ONE STAGE AT A TIME in the Supabase SQL Editor, in order. Every stage
-- ends with a real SELECT so the row counts land in the results panel — the
-- editor does not surface RAISE NOTICE output, so nothing important is
-- reported only as a notice.
--
--   Stage 1  wipe            (this file, below)
--   Stage 2  accounts        4 brands, 4–17 accounts each, 42 total
--   Stage 3  sample data     services, products, clients, schedules,
--                            appointments, gift cards, packages
--   Stage 4  verification    final counts + invariant checks
--
-- ===========================================================================
-- STAGE 1 — WIPE
-- ===========================================================================
--
-- Delete order is derived from the actual foreign-key graph in
-- supabase/migrations, children before parents, not written from memory.
--
-- TWO DEPARTURES FROM THE TABLE LIST AS BRIEFED, both deliberate:
--
--   * public.payments IS INCLUDED. It was not in the brief's list, but it is
--     the Phase-A deposits table and the parent of payment_events. Leaving it
--     would strand payment rows pointing at deleted appointments and would
--     make the "everything deleted" claim false.
--
--   * public.app_job_config IS **NOT** TOUCHED. Despite being a table with
--     rows, it is configuration seeded by migration 20260802045654
--     (jobs_base_url and friends), not test data. Wiping it would silently
--     disable HTTP-dispatched scheduled jobs. If you genuinely want it reset,
--     re-run that migration rather than deleting rows here.
--
-- WHY payment_events IS TRUNCATED RATHER THAN DELETED
--
--   payment_events carries a BEFORE UPDATE OR DELETE row-level trigger
--   (payment_events_append_only) that raises check_violation for every caller
--   including service_role — the audit log is append-only by design and a
--   DELETE here would correctly fail.
--
--   TRUNCATE fires only statement-level BEFORE TRUNCATE triggers, and none is
--   defined, so it bypasses that guard. That is the right tool for a total
--   test-data wipe and the wrong tool for any partial cleanup: nothing about
--   TRUNCATE respects the append-only guarantee, it simply is not covered by
--   it. Do not copy this line into a targeted cleanup script.
--
--   Worth recording separately: this means the append-only guarantee is not
--   actually absolute. The migration comment claims no mutation "for anyone,
--   including service_role", and TRUNCATE walks straight through it. That is
--   a real gap in the guarantee, independent of this reset.
--
-- The whole stage runs in one transaction. If any statement fails, nothing is
-- deleted — re-run after fixing rather than ending up half-wiped.
-- ===========================================================================

BEGIN;

DROP TABLE IF EXISTS _wipe_counts;
CREATE TEMP TABLE _wipe_counts (
  seq          int,
  tbl          text,
  before_count bigint,
  after_count  bigint
);

-- Snapshot every table's row count BEFORE anything is removed. Counting after
-- the fact would miss rows that disappeared via ON DELETE CASCADE rather than
-- via their own DELETE statement, and this reset relies on several cascades.
DO $$
DECLARE
  v_tables text[] := ARRAY[
    'public.user_roles',
    'public.service_location_prices',
    'public.location_stock',
    'public.stock_movements',
    'public.staff_schedules',
    'public.staff_leave',
    'public.service_record_products',
    'public.service_records',
    'public.income_records',
    'public.booking_tokens',
    'public.payment_events',
    'public.payments',
    'public.appointments',
    'public.gift_card_redemptions',
    'public.gift_cards',
    'public.client_package_service_balances',
    'public.package_redemptions',
    'public.client_packages',
    'public.staff_location_history',
    'public.locations',
    'public.clients',
    'public.staff_services',
    'public.package_services',
    'public.services',
    'public.products',
    'public.booking_otps',
    'public.whatsapp_templates',
    'public.whatsapp_messages',
    'public.package_types',
    'public.staff_photos',
    'public.plan_upgrade_requests',
    'public.brands',
    'public.staff_personal_details',
    'public.profiles',
    'public.platform_admins',
    'auth.identities',
    'auth.users'
  ];
  v_tbl text;
  v_n   bigint;
  v_i   int := 0;
BEGIN
  FOREACH v_tbl IN ARRAY v_tables LOOP
    v_i := v_i + 1;
    EXECUTE format('SELECT count(*) FROM %s', v_tbl) INTO v_n;
    INSERT INTO _wipe_counts(seq, tbl, before_count) VALUES (v_i, v_tbl, v_n);
  END LOOP;
  RAISE NOTICE 'snapshot taken for % tables', v_i;
END $$;

-- ---------------------------------------------------------------------------
-- Deletes, children first.
-- ---------------------------------------------------------------------------

DELETE FROM public.user_roles;
DELETE FROM public.service_location_prices;
DELETE FROM public.location_stock;
DELETE FROM public.stock_movements;
DELETE FROM public.staff_schedules;
DELETE FROM public.staff_leave;
DELETE FROM public.service_record_products;
DELETE FROM public.service_records;
DELETE FROM public.income_records;
DELETE FROM public.booking_tokens;

-- See the header: DELETE is correctly refused by the append-only trigger, so a
-- full wipe uses TRUNCATE. Runs before public.payments, which it references.
TRUNCATE TABLE public.payment_events;

DELETE FROM public.payments;
DELETE FROM public.appointments;
DELETE FROM public.gift_card_redemptions;
DELETE FROM public.gift_cards;
DELETE FROM public.client_package_service_balances;
DELETE FROM public.package_redemptions;
DELETE FROM public.client_packages;
DELETE FROM public.staff_location_history;
DELETE FROM public.locations;
DELETE FROM public.clients;
DELETE FROM public.staff_services;
DELETE FROM public.package_services;
DELETE FROM public.services;
DELETE FROM public.products;
DELETE FROM public.booking_otps;
DELETE FROM public.whatsapp_templates;
DELETE FROM public.whatsapp_messages;
DELETE FROM public.package_types;
DELETE FROM public.staff_photos;
DELETE FROM public.plan_upgrade_requests;
DELETE FROM public.brands;
DELETE FROM public.staff_personal_details;
DELETE FROM public.profiles;
DELETE FROM public.platform_admins;

-- auth last. Deleting auth.users cascades to auth.identities; the explicit
-- delete first makes the count visible rather than implied.
DELETE FROM auth.identities;
DELETE FROM auth.users;

-- ---------------------------------------------------------------------------
-- Re-count and report.
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  r     record;
  v_n   bigint;
BEGIN
  FOR r IN SELECT seq, tbl FROM _wipe_counts ORDER BY seq LOOP
    EXECUTE format('SELECT count(*) FROM %s', r.tbl) INTO v_n;
    UPDATE _wipe_counts SET after_count = v_n WHERE seq = r.seq;
  END LOOP;
END $$;

COMMIT;

-- FINAL RESULT — deliberately placed AFTER the COMMIT.
--
-- The SQL Editor shows the result of the LAST statement that returns rows, and
-- a trailing COMMIT returns nothing — putting this SELECT before it produces
-- "Success. No rows returned" and hides the very numbers this stage exists to
-- report. The temp table is session-scoped, not transaction-scoped, so it
-- survives the commit and is still readable here.
--
-- `deleted` is before minus after, so rows removed via ON DELETE CASCADE are
-- counted too. Any row where rows_after > 0 is a wipe failure — investigate
-- before running Stage 2.
SELECT
  seq                                   AS "#",
  tbl                                   AS "table",
  before_count                          AS "rows_before",
  after_count                           AS "rows_after",
  before_count - after_count            AS "deleted",
  CASE WHEN after_count = 0 THEN 'clean' ELSE '*** NOT EMPTY ***' END AS "state"
FROM _wipe_counts
UNION ALL
SELECT
  999,
  'TOTAL',
  sum(before_count),
  sum(after_count),
  sum(before_count - after_count),
  CASE WHEN sum(after_count) = 0 THEN 'ALL CLEAN' ELSE '*** WIPE INCOMPLETE ***' END
FROM _wipe_counts
ORDER BY 1;

-- ===========================================================================
-- Stage 1 ends here. Check the results panel:
--   * every row should read 'clean'
--   * the TOTAL row should read 'ALL CLEAN'
--   * app_job_config is intentionally absent from this report — untouched
--
-- Paste the results back before running Stage 2. Stages 2–4 are appended to
-- this file once Stage 1 is confirmed.
-- ===========================================================================


-- ===========================================================================
-- STAGE 2 — ACCOUNTS AND BRANDS
--
-- Creates 4 brands, 9 locations and 42 auth accounts. Run only after Stage 1
-- reports ALL CLEAN. Safe to re-run: it aborts if any qsalontest.com account
-- already exists rather than half-creating a second set.
--
-- Password for every account: TestPass123!
--
-- THREE SCHEMA FACTS THIS DEPENDS ON, each checked against the migrations
-- rather than assumed:
--
--   1. `on_auth_user_created` is an AFTER INSERT trigger on auth.users that
--      creates the public.profiles row from raw_user_meta_data->>'full_name'.
--      Profiles are therefore NOT inserted here — doing so would race the
--      trigger. The trigger does not set profiles.email (a later migration
--      added that column), so email is backfilled once the users exist.
--
--   2. pgcrypto lives in the `extensions` schema, not public (bug class §4.2),
--      so crypt() and gen_salt() are fully qualified. An unqualified call
--      fails here, and widening search_path is not the fix.
--
--   3. brands.slug is NOT NULL with a unique index, and plan limits are
--      MIRRORED onto the brand row rather than looked up (§12). The numbers
--      below are transcribed from src/lib/plan-limits.ts:
--         starter      1 location  / 10 staff
--         growth       1 location  / 20 staff
--         professional 3 locations / 50 staff
--         enterprise   999 / 999   (the UNLIMITED sentinel)
--
-- PLAN-LIMIT HEADROOM (staff counts exclude the Owner, per §2):
--   Starter       4 of 10      Growth        6 of 20
--   Professional 12 of 50      Enterprise   16 of 999
--   Professional uses exactly 3 of 3 locations — at the ceiling by design, so
--   a later location add-on test starts from a full brand.
--
-- No appointments or staff_services are created here, so the bookable-staff
-- trigger is not exercised until Stage 3.
-- ===========================================================================

BEGIN;

-- Refuse to double-seed.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM auth.users WHERE email LIKE '%@qsalontest.com') THEN
    RAISE EXCEPTION 'ABORT: qsalontest.com accounts already exist — re-run Stage 1 first';
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- Helper: mint a confirmed email/password user.
--
-- The empty-string token columns are deliberate rather than lazy: GoTrue reads
-- NULL confirmation_token / recovery_token / email_change as malformed on some
-- versions and sign-in then fails with an opaque error. '' is the safe value.
--
-- auth.identities.provider_id is required by newer GoTrue and absent from
-- older releases, so it is written only when the column actually exists — this
-- has to run against whatever version the project is currently on, and I
-- cannot inspect the live auth schema from here.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._seed_create_user(
  p_email     text,
  p_password  text,
  p_full_name text
) RETURNS uuid
LANGUAGE plpgsql
AS $fn$
DECLARE
  v_id uuid := gen_random_uuid();
  v_has_provider_id boolean;
BEGIN
  INSERT INTO auth.users (
    instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
    created_at, updated_at,
    confirmation_token, recovery_token, email_change_token_new, email_change
  ) VALUES (
    '00000000-0000-0000-0000-000000000000', v_id, 'authenticated', 'authenticated',
    p_email, extensions.crypt(p_password, extensions.gen_salt('bf')),
    now(), '{"provider":"email","providers":["email"]}'::jsonb,
    jsonb_build_object('full_name', p_full_name),
    now(), now(), '', '', '', ''
  );

  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'auth' AND table_name = 'identities' AND column_name = 'provider_id'
  ) INTO v_has_provider_id;

  IF v_has_provider_id THEN
    INSERT INTO auth.identities (id, user_id, identity_data, provider, provider_id,
                                 last_sign_in_at, created_at, updated_at)
    VALUES (gen_random_uuid(), v_id,
            jsonb_build_object('sub', v_id::text, 'email', p_email),
            'email', v_id::text, now(), now(), now());
  ELSE
    INSERT INTO auth.identities (id, user_id, identity_data, provider,
                                 last_sign_in_at, created_at, updated_at)
    VALUES (gen_random_uuid(), v_id,
            jsonb_build_object('sub', v_id::text, 'email', p_email),
            'email', now(), now(), now());
  END IF;

  RETURN v_id;
END $fn$;

-- ---------------------------------------------------------------------------
-- Brands, locations, accounts.
--
-- Email numbering follows the brief exactly: a role with one holder carries no
-- digit (starter-manager@), a role with several is numbered from 1
-- (growth-receptionist1@). Managers and receptionists map one-per-location in
-- location order where the counts line up; where they do not (Starter, Growth)
-- everyone sits at Main Branch, which is the only location those plans allow.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  PW        constant text := 'TestPass123!';
  v_brand   uuid;
  v_owner   uuid;
  v_uid     uuid;
  L         uuid[];
  i         int;
  n         int;
  v_specs   jsonb := '[
    {"key":"starter",      "name":"Starter Test Salon",      "slug":"starter-test-salon",
     "plan":"starter",      "max_loc":1,   "max_staff":10,
     "locations":["Main Branch"],
     "managers":1, "receptionists":1, "staff_per_location":2},
    {"key":"growth",       "name":"Growth Test Salon",       "slug":"growth-test-salon",
     "plan":"growth",       "max_loc":1,   "max_staff":20,
     "locations":["Main Branch"],
     "managers":1, "receptionists":2, "staff_per_location":3},
    {"key":"professional", "name":"Professional Test Salon", "slug":"professional-test-salon",
     "plan":"professional", "max_loc":3,   "max_staff":50,
     "locations":["Main Branch","Al Sadd Branch","Al Waab Branch"],
     "managers":3, "receptionists":3, "staff_per_location":2},
    {"key":"enterprise",   "name":"Enterprise Test Salon",   "slug":"enterprise-test-salon",
     "plan":"enterprise",   "max_loc":999, "max_staff":999,
     "locations":["Main Branch","Msheireb Branch","Lusail Branch","Pearl Branch"],
     "managers":4, "receptionists":4, "staff_per_location":2}
  ]'::jsonb;
  s         jsonb;
  v_key     text;
  v_locs    jsonb;
  v_nloc    int;
  v_staff_n int;
  v_title   text;
  v_suffix  text;
BEGIN
  FOR s IN SELECT * FROM jsonb_array_elements(v_specs) LOOP
    v_key   := s->>'key';
    v_locs  := s->'locations';
    v_nloc  := jsonb_array_length(v_locs);
    v_title := initcap(v_key);

    -- Owner first: brands.owner_user_id needs a real id to point at.
    v_owner := public._seed_create_user(
      'owner-' || v_key || '@qsalontest.com', PW, v_title || ' Owner');

    INSERT INTO public.brands (
      owner_user_id, name, slug, plan,
      max_locations, max_staff_accounts, addon_locations,
      subscription_status, billing_cycle, currency
    ) VALUES (
      v_owner, s->>'name', s->>'slug', (s->>'plan')::public.subscription_plan,
      (s->>'max_loc')::int, (s->>'max_staff')::int, 0,
      'trial', 'monthly', 'QAR'
    ) RETURNING id INTO v_brand;

    -- An Owner is brand-wide, so the role row carries no location.
    INSERT INTO public.user_roles (user_id, role, brand_id, location_id)
    VALUES (v_owner, 'owner', v_brand, NULL);

    -- Locations, in the order given. enforce_location_plan_limit reads
    -- brands.max_locations, which is why the brand row is created first.
    L := ARRAY[]::uuid[];
    FOR i IN 0 .. v_nloc - 1 LOOP
      INSERT INTO public.locations (brand_id, name)
      VALUES (v_brand, v_locs->>i)
      RETURNING id INTO v_uid;
      L := L || v_uid;
    END LOOP;

    -- Managers.
    FOR i IN 1 .. (s->>'managers')::int LOOP
      v_suffix := CASE WHEN (s->>'managers')::int = 1 THEN '' ELSE i::text END;
      v_uid := public._seed_create_user(
        v_key || '-manager' || v_suffix || '@qsalontest.com',
        PW, v_title || ' Manager ' || i);
      INSERT INTO public.user_roles (user_id, role, brand_id, location_id)
      VALUES (v_uid, 'manager', v_brand, L[least(i, v_nloc)]);
    END LOOP;

    -- Receptionists.
    FOR i IN 1 .. (s->>'receptionists')::int LOOP
      v_uid := public._seed_create_user(
        v_key || '-receptionist' || i || '@qsalontest.com',
        PW, v_title || ' Receptionist ' || i);
      INSERT INTO public.user_roles (user_id, role, brand_id, location_id)
      VALUES (v_uid, 'receptionist', v_brand,
              CASE WHEN (s->>'receptionists')::int = v_nloc THEN L[i] ELSE L[1] END);
    END LOOP;

    -- Staff: staff_per_location at each location, numbered continuously so the
    -- emails read staff1..staffN across the brand rather than restarting.
    v_staff_n := 0;
    FOR i IN 1 .. v_nloc LOOP
      FOR n IN 1 .. (s->>'staff_per_location')::int LOOP
        v_staff_n := v_staff_n + 1;
        v_uid := public._seed_create_user(
          v_key || '-staff' || v_staff_n || '@qsalontest.com',
          PW, v_title || ' Staff ' || v_staff_n);
        INSERT INTO public.user_roles (user_id, role, brand_id, location_id)
        VALUES (v_uid, 'staff', v_brand, L[i]);
      END LOOP;
    END LOOP;

    RAISE NOTICE 'seeded % (% locations)', s->>'name', v_nloc;
  END LOOP;
END $$;

-- profiles.email is not populated by the on_auth_user_created trigger.
UPDATE public.profiles p
   SET email = u.email
  FROM auth.users u
 WHERE u.id = p.id AND p.email IS DISTINCT FROM u.email;

-- The helper can mint an authenticated user with an arbitrary password. Drop
-- it rather than leave it sitting in a database that becomes production.
DROP FUNCTION IF EXISTS public._seed_create_user(text, text, text);

COMMIT;

-- ---------------------------------------------------------------------------
-- FINAL RESULT — after COMMIT, so the editor shows it rather than the commit.
--
-- `limit_state` is the check that matters: it recomputes staff and location
-- usage against the mirrored limits on each brand. Anything other than 'ok'
-- means a plan-limit trigger should have fired and the seed is wrong.
--
-- Wrapped in a subquery with an explicit sort key. A bare
-- `SELECT … UNION ALL SELECT … LIMIT 1` applies the LIMIT to the *whole* union
-- in Postgres, not to the second branch — that returns one row and hides the
-- per-brand breakdown entirely. The TOTAL branch also has no FROM clause, so
-- it yields exactly one row without needing a LIMIT at all.
-- ---------------------------------------------------------------------------
SELECT
  "brand", "plan", "max_loc", "max_staff", "locations",
  "owners", "managers", "receptionists", "staff", "accounts", "limit_state"
FROM (
SELECT
  1 AS ord,
  b.name                                                       AS "brand",
  b.plan::text                                                 AS "plan",
  b.max_locations                                              AS "max_loc",
  b.max_staff_accounts                                         AS "max_staff",
  (SELECT count(*) FROM public.locations l WHERE l.brand_id = b.id)                                  AS "locations",
  (SELECT count(*) FROM public.user_roles r WHERE r.brand_id = b.id AND r.role = 'owner')            AS "owners",
  (SELECT count(*) FROM public.user_roles r WHERE r.brand_id = b.id AND r.role = 'manager')          AS "managers",
  (SELECT count(*) FROM public.user_roles r WHERE r.brand_id = b.id AND r.role = 'receptionist')     AS "receptionists",
  (SELECT count(*) FROM public.user_roles r WHERE r.brand_id = b.id AND r.role = 'staff')            AS "staff",
  (SELECT count(*) FROM public.user_roles r WHERE r.brand_id = b.id)                                 AS "accounts",
  CASE
    WHEN (SELECT count(*) FROM public.locations l WHERE l.brand_id = b.id) > b.max_locations
      THEN '*** OVER LOCATION LIMIT ***'
    WHEN (SELECT count(*) FROM public.user_roles r WHERE r.brand_id = b.id AND r.role <> 'owner') > b.max_staff_accounts
      THEN '*** OVER STAFF LIMIT ***'
    ELSE 'ok'
  END                                                          AS "limit_state"
FROM public.brands b

UNION ALL

-- No FROM clause: this branch is all scalar subqueries and returns exactly one
-- row. `accounts` here is the auth.users total, which is the number that must
-- read 42.
SELECT
  2,
  'TOTAL',
  ''::text,
  NULL::int,
  NULL::int,
  (SELECT count(*) FROM public.locations),
  (SELECT count(*) FROM public.user_roles WHERE role = 'owner'),
  (SELECT count(*) FROM public.user_roles WHERE role = 'manager'),
  (SELECT count(*) FROM public.user_roles WHERE role = 'receptionist'),
  (SELECT count(*) FROM public.user_roles WHERE role = 'staff'),
  (SELECT count(*) FROM auth.users),
  CASE WHEN (SELECT count(*) FROM auth.users)                          = 42
        AND (SELECT count(*) FROM auth.identities)                     = 42
        AND (SELECT count(*) FROM public.profiles)                     = 42
        AND (SELECT count(*) FROM public.profiles WHERE email IS NULL) = 0
        AND (SELECT count(*) FROM public.user_roles)                   = 42
        AND (SELECT count(*) FROM public.locations)                    = 9
        AND (SELECT count(*) FROM public.brands)                       = 4
       THEN 'ALL OK — 42 users / 42 identities / 42 profiles / 42 roles / 9 locations / 4 brands'
       ELSE '*** MISMATCH — check users, identities, profiles, roles, locations, brands ***'
  END
) x
ORDER BY ord, "brand";

-- ===========================================================================
-- RE-ADD YOURSELF AS PLATFORM ADMIN
--
-- platform_admins was emptied by Stage 1 and /admin is unreachable until this
-- runs. It is NOT executed automatically: it would have to guess which of the
-- 42 seeded accounts is you, and platform admin is the one role that can
-- change any brand's plan and limits.
--
-- Your previous login no longer exists — Stage 1 deleted every auth.users row
-- — so pick one of the seeded owners to administer from, or create a separate
-- account for yourself through the app's sign-up first and use that email.
--
-- Replace the email, then run:
--
--   INSERT INTO public.platform_admins (user_id)
--   SELECT id FROM auth.users WHERE email = 'owner-enterprise@qsalontest.com'
--   ON CONFLICT (user_id) DO NOTHING;
--
-- Verify:
--
--   SELECT u.email, pa.created_at
--     FROM public.platform_admins pa
--     JOIN auth.users u ON u.id = pa.user_id;
--
-- Note this deliberately grants platform admin to a *test* account. If this
-- database will ever hold real customers, use your own real account instead
-- and remove the test grant before that happens.
-- ===========================================================================


-- ===========================================================================
-- STAGE 3 — SAMPLE DATA
--
-- Per brand: 8 services, 8 products with per-location stock, 12 clients,
-- staff_services + staff_schedules for every staff-role account, ~24
-- appointments spanning the last 30 and next 14 days, service_records and
-- income_records for completed ones, 3 gift cards, and 2 package types with
-- sales including one partial redemption.
--
-- Run only after Stage 2 reports ALL OK.
--
-- CONSTRAINTS THIS SEED IS BUILT AROUND, each read from the migrations:
--
--   1. BOOKABLE-STAFF RESTRICTION. enforce_bookable_staff_role rejects any
--      appointments.staff_user_id or staff_services.user_id that is not a
--      role='staff' account. Every loop below draws its actors from
--      user_roles WHERE role = 'staff' — Owners, Managers and Receptionists
--      are never candidates, so the trigger is satisfied by construction
--      rather than by luck.
--
--   2. OVERLAP PREVENTION. prevent_appointment_overlap rejects two
--      non-cancelled appointments for the same staff member whose times
--      intersect. Cancelled rows are exempt. Slots are therefore allocated
--      deterministically: each appointment for a given staff member lands on
--      its own day at its own hour, spaced two hours apart within a day, so no
--      two can intersect. Nothing here relies on random times not colliding.
--
--   3. income_records.appointment_id IS **NOT NULL**. Income cannot exist
--      without an appointment in this schema, so income is written only for
--      completed appointments. Gift-card and package sales therefore do NOT
--      produce income_records here — their revenue lives on the gift_cards /
--      client_packages rows themselves.
--
--   4. Money-shaped CHECK constraints that will reject bad seed data outright:
--        gift_cards        remaining_amount <= initial_amount, both > 0 / >= 0
--        client_package_service_balances   remaining_count <= included_count
--        package_types     price > 0, expiry_months BETWEEN 1 AND 120
--      Every literal below is inside these ranges.
--
--   5. PLAN LIMITS ARE UNTOUCHED. This stage creates no locations and no
--      user_roles, so neither enforce_location_plan_limit nor
--      enforce_staff_plan_limit can fire.
--
-- Deterministic by design: no random(), so re-running after a Stage 1+2 reset
-- reproduces the same data and the same numbers.
-- ===========================================================================

BEGIN;

DO $$
DECLARE
  b            record;
  loc          record;
  svc          record;
  stf          record;
  cli          record;
  v_svc_ids    uuid[];
  v_loc_ids    uuid[];
  v_cli_ids    uuid[];
  v_stf_ids    uuid[];
  v_prod_ids   uuid[];
  v_pkg        uuid;
  v_cp         uuid;
  v_gc_client  uuid;
  i            int;
  j            int;
  k            int;
  n            int;
  v_start      timestamptz;
  v_dur        int;
  v_price      numeric(12,2);
  v_status     public.appointment_status;
  v_appt       uuid;
  v_day        int;
  v_hour       int;
  v_seq        int;
  v_brand_ix   int := 0;
  v_staff_cnt  int;
  v_per_staff  int;

  -- 8 services: name, minutes, price
  v_services   jsonb := '[
    {"n":"Haircut & Blow Dry",     "m":45,  "p":120},
    {"n":"Full Head Colour",       "m":120, "p":420},
    {"n":"Balayage",               "m":150, "p":650},
    {"n":"Keratin Treatment",      "m":90,  "p":550},
    {"n":"Classic Manicure",       "m":45,  "p":90},
    {"n":"Gel Pedicure",           "m":60,  "p":140},
    {"n":"Deep Cleansing Facial",  "m":60,  "p":260},
    {"n":"Bridal Styling",         "m":180, "p":900}
  ]'::jsonb;

  -- 8 products: name, unit, cost
  v_products   jsonb := '[
    {"n":"Developer 20 Vol",       "u":"litre", "c":38},
    {"n":"Permanent Colour Tube",  "u":"tube",  "c":26},
    {"n":"Bleach Powder",          "u":"kg",    "c":95},
    {"n":"Keratin Solution",       "u":"litre", "c":180},
    {"n":"Shampoo (Salon 5L)",     "u":"litre", "c":62},
    {"n":"Conditioner (Salon 5L)", "u":"litre", "c":58},
    {"n":"Gel Polish",             "u":"bottle","c":34},
    {"n":"Facial Serum",           "u":"bottle","c":110}
  ]'::jsonb;

  v_client_names text[] := ARRAY[
    'Aisha Al-Kuwari','Fatima Al-Thani','Noor Al-Sulaiti','Maryam Al-Marri',
    'Hessa Al-Mannai','Sara Al-Emadi','Layla Al-Mansoori','Huda Al-Sayed',
    'Reem Al-Dosari','Salma Hassan','Dana Al-Ansari','Mona Al-Khater'];

  v_statuses public.appointment_status[] :=
    ARRAY['completed','completed','completed','scheduled','no_show','cancelled']::public.appointment_status[];
BEGIN
FOR b IN SELECT id, name, currency FROM public.brands ORDER BY created_at LOOP
  v_brand_ix := v_brand_ix + 1;

  SELECT array_agg(id ORDER BY created_at) INTO v_loc_ids
    FROM public.locations WHERE brand_id = b.id;

  -- ---------------------------------------------------------------------
  -- Services
  -- ---------------------------------------------------------------------
  v_svc_ids := ARRAY[]::uuid[];
  FOR i IN 0 .. jsonb_array_length(v_services) - 1 LOOP
    INSERT INTO public.services (brand_id, name, duration_minutes, default_price, currency, is_active)
    VALUES (b.id, v_services->i->>'n', (v_services->i->>'m')::int,
            (v_services->i->>'p')::numeric, b.currency, true)
    RETURNING id INTO v_appt;
    v_svc_ids := v_svc_ids || v_appt;
  END LOOP;

  -- Per-location price overrides, only where there is more than one location
  -- to differentiate — the feature is meaningless on a single-branch brand.
  IF array_length(v_loc_ids, 1) > 1 THEN
    FOR i IN 2 .. array_length(v_loc_ids, 1) LOOP
      -- two overrides per non-primary location: a premium and a discount
      INSERT INTO public.service_location_prices (service_id, location_id, price, currency)
      VALUES (v_svc_ids[2], v_loc_ids[i], 420 + (i * 25), b.currency)
      ON CONFLICT (service_id, location_id) DO NOTHING;
      INSERT INTO public.service_location_prices (service_id, location_id, price, currency)
      VALUES (v_svc_ids[5], v_loc_ids[i], 90 - (i * 5), b.currency)
      ON CONFLICT (service_id, location_id) DO NOTHING;
    END LOOP;
  END IF;

  -- ---------------------------------------------------------------------
  -- Products + stock at every location.
  -- Products 3 and 7 are deliberately at or below threshold so the low-stock
  -- report has something real to show; product 4 is at zero.
  -- ---------------------------------------------------------------------
  v_prod_ids := ARRAY[]::uuid[];
  FOR i IN 0 .. jsonb_array_length(v_products) - 1 LOOP
    INSERT INTO public.products (brand_id, name, unit, cost_price, currency, is_active)
    VALUES (b.id, v_products->i->>'n', v_products->i->>'u',
            (v_products->i->>'c')::numeric, b.currency, true)
    RETURNING id INTO v_appt;
    v_prod_ids := v_prod_ids || v_appt;
  END LOOP;

  FOREACH v_appt IN ARRAY v_loc_ids LOOP
    FOR i IN 1 .. array_length(v_prod_ids, 1) LOOP
      INSERT INTO public.location_stock (location_id, product_id, quantity, low_stock_threshold)
      VALUES (
        v_appt, v_prod_ids[i],
        CASE i WHEN 3 THEN 2 WHEN 4 THEN 0 WHEN 7 THEN 1 ELSE 10 + i END,
        CASE i WHEN 3 THEN 5 WHEN 4 THEN 3 WHEN 7 THEN 4 ELSE 3 END
      )
      ON CONFLICT (location_id, product_id) DO NOTHING;
    END LOOP;
  END LOOP;

  -- ---------------------------------------------------------------------
  -- Clients — brand-wide, per the data model.
  -- ---------------------------------------------------------------------
  v_cli_ids := ARRAY[]::uuid[];
  FOR i IN 1 .. array_length(v_client_names, 1) LOOP
    INSERT INTO public.clients (brand_id, name, phone, email)
    VALUES (b.id, v_client_names[i],
            '+9745' || lpad(((v_brand_ix * 100) + i)::text, 7, '0'),
            lower(replace(split_part(v_client_names[i], ' ', 1), '''', '')) ||
              v_brand_ix::text || i::text || '@example.qa')
    RETURNING id INTO v_appt;
    v_cli_ids := v_cli_ids || v_appt;
  END LOOP;

  -- ---------------------------------------------------------------------
  -- Staff-role accounts ONLY. This is the single source of actors for both
  -- staff_services and appointments, so the bookable-staff trigger cannot be
  -- tripped by anything below.
  -- ---------------------------------------------------------------------
  -- Appointments per staff member are derived from headcount so that EVERY
  -- brand lands inside the 20–30 range, whether it has 2 staff or 8. A fixed
  -- per-staff count cannot do that: 6 each would give Starter 12 and
  -- Enterprise 48, both outside the range. ceil(24 / headcount) puts all four
  -- brands at exactly 24.
  SELECT count(*) INTO v_staff_cnt
    FROM public.user_roles r WHERE r.brand_id = b.id AND r.role = 'staff';
  v_per_staff := ceil(24.0 / greatest(v_staff_cnt, 1))::int;

  v_seq := 0;
  FOR stf IN
    SELECT r.user_id, r.location_id
      FROM public.user_roles r
     WHERE r.brand_id = b.id AND r.role = 'staff'
     ORDER BY r.created_at
  LOOP
    v_seq := v_seq + 1;

    -- staff_services: 4 services each, rotating so coverage differs per person
    -- while every service stays bookable by someone.
    FOR j IN 0 .. 3 LOOP
      INSERT INTO public.staff_services (brand_id, user_id, service_id)
      VALUES (b.id, stf.user_id, v_svc_ids[1 + ((v_seq + j) % array_length(v_svc_ids, 1))])
      ON CONFLICT (user_id, service_id) DO NOTHING;
    END LOOP;

    -- staff_schedules: Sunday–Thursday, the Qatar working week. day_of_week 0
    -- is Sunday, matching weekStartsOn: 0 used throughout the product.
    FOR j IN 0 .. 4 LOOP
      INSERT INTO public.staff_schedules (user_id, location_id, day_of_week, start_time, end_time)
      VALUES (stf.user_id, stf.location_id, j,
              CASE WHEN v_seq % 2 = 0 THEN TIME '11:00' ELSE TIME '09:00' END,
              CASE WHEN v_seq % 2 = 0 THEN TIME '20:00' ELSE TIME '18:00' END);
    END LOOP;

    -- -------------------------------------------------------------------
    -- Appointments for this staff member.
    --
    -- Slot allocation is what keeps prevent_appointment_overlap happy: each
    -- iteration takes its own day (n) and its own hour within that day, two
    -- hours apart. Two appointments for the same person can therefore never
    -- intersect regardless of service duration, which tops out at 180 min.
    -- -------------------------------------------------------------------
    FOR n IN 0 .. v_per_staff - 1 LOOP
      -- Spread this staff member's appointments evenly across the whole
      -- −28d .. +14d window regardless of how many they have, so every brand
      -- gets both history and future bookings. Each n resolves to its own day
      -- for a given staff member, which is what makes overlap impossible.
      v_day    := -28 + round(n * 42.0 / greatest(v_per_staff - 1, 1))::int;
      v_hour   := 9 + ((n % 3) * 3);                    -- 09:00 / 12:00 / 15:00
      v_status := v_statuses[1 + ((v_seq + n) % array_length(v_statuses, 1))];

      -- A future appointment cannot already be completed or a no-show.
      IF v_day > 0 AND v_status IN ('completed', 'no_show') THEN
        v_status := 'scheduled';
      END IF;
      -- A past appointment left as 'scheduled' is stale data, not test data.
      IF v_day < 0 AND v_status = 'scheduled' THEN
        v_status := 'completed';
      END IF;

      k       := 1 + ((v_seq + n) % array_length(v_svc_ids, 1));
      v_dur   := (v_services->(k - 1)->>'m')::int;
      v_price := (v_services->(k - 1)->>'p')::numeric;
      v_start := date_trunc('day', now() + make_interval(days => v_day))
                 + make_interval(hours => v_hour);

      INSERT INTO public.appointments (
        brand_id, location_id, client_id, staff_user_id, service_id,
        starts_at, ends_at, status, price, currency
      ) VALUES (
        b.id, stf.location_id,
        v_cli_ids[1 + ((v_seq * 3 + n) % array_length(v_cli_ids, 1))],
        stf.user_id, v_svc_ids[k],
        v_start, v_start + make_interval(mins => v_dur),
        v_status, v_price, b.currency
      ) RETURNING id INTO v_appt;

      -- Completed visits get a service record and the money that came with it.
      IF v_status = 'completed' THEN
        INSERT INTO public.service_records (appointment_id, technician_user_id, service_performed)
        VALUES (v_appt, stf.user_id, v_services->(k - 1)->>'n');

        INSERT INTO public.income_records (
          appointment_id, location_id, brand_id, amount, currency, method, collected_at, collected_by
        ) VALUES (
          v_appt, stf.location_id, b.id, v_price, b.currency,
          (ARRAY['cash','card','bank_transfer']::public.payment_method[])[1 + ((v_seq + n) % 3)],
          v_start + make_interval(mins => v_dur), stf.user_id
        );
      END IF;
    END LOOP;
  END LOOP;

  -- ---------------------------------------------------------------------
  -- Gift cards — 3 per brand, the second partially redeemed.
  -- Codes are namespaced per brand so the global UNIQUE on code holds.
  -- ---------------------------------------------------------------------
  FOR i IN 1 .. 3 LOOP
    v_gc_client := CASE WHEN i = 1 THEN NULL ELSE v_cli_ids[i] END;
    INSERT INTO public.gift_cards (
      brand_id, location_id, code, initial_amount, remaining_amount,
      currency, expires_at, status, client_id
    ) VALUES (
      b.id, v_loc_ids[1],
      'GC-' || upper(left(md5(b.id::text), 4)) || '-' || lpad(i::text, 3, '0'),
      (ARRAY[500, 300, 1000])[i],
      -- card 2 is half spent; the others are untouched
      CASE i WHEN 2 THEN 150 ELSE (ARRAY[500, 300, 1000])[i] END,
      b.currency,
      now() + interval '12 months',
      'active', v_gc_client
    ) RETURNING id INTO v_appt;

    IF i = 2 THEN
      INSERT INTO public.gift_card_redemptions (gift_card_id, brand_id, client_id, amount, currency)
      VALUES (v_appt, b.id, v_gc_client, 150, b.currency);
    END IF;
  END LOOP;

  -- ---------------------------------------------------------------------
  -- Packages — 2 types per brand, 3 sales, one partially redeemed.
  -- Balances are written explicitly rather than via package_sell, because
  -- that RPC gates on can_manage_location(auth.uid(), …) and this script runs
  -- as postgres with no JWT. The rows it produces are reproduced faithfully:
  -- one balance row per included service, remaining <= included.
  -- ---------------------------------------------------------------------
  FOR i IN 1 .. 2 LOOP
    INSERT INTO public.package_types (brand_id, name, description, price, currency, expiry_months, status)
    VALUES (
      b.id,
      (ARRAY['Colour & Care Bundle', 'Nails Monthly'])[i],
      (ARRAY['Full head colour plus two conditioning treatments.',
             'A manicure and a pedicure every month.'])[i],
      (ARRAY[1100, 400])[i], b.currency, (ARRAY[12, 6])[i], 'active'
    ) RETURNING id INTO v_pkg;

    IF i = 1 THEN
      INSERT INTO public.package_services (package_type_id, service_id, included_count)
      VALUES (v_pkg, v_svc_ids[2], 3), (v_pkg, v_svc_ids[7], 2);
    ELSE
      INSERT INTO public.package_services (package_type_id, service_id, included_count)
      VALUES (v_pkg, v_svc_ids[5], 2), (v_pkg, v_svc_ids[6], 2);
    END IF;

    -- Sales: 2 of type 1, 1 of type 2. The first sale of type 1 has one
    -- session already used, which is the partially-redeemed case.
    FOR j IN 1 .. (CASE WHEN i = 1 THEN 2 ELSE 1 END) LOOP
      INSERT INTO public.client_packages (
        brand_id, location_id, client_id, package_type_id,
        price_paid, currency, purchased_at, expires_at, status
      ) VALUES (
        b.id, v_loc_ids[1], v_cli_ids[(i * 2) + j], v_pkg,
        (ARRAY[1100, 400])[i], b.currency,
        now() - interval '20 days',
        now() - interval '20 days' + make_interval(months => (ARRAY[12, 6])[i]),
        'active'
      ) RETURNING id INTO v_cp;

      IF i = 1 THEN
        INSERT INTO public.client_package_service_balances
          (client_package_id, service_id, included_count, remaining_count)
        VALUES
          (v_cp, v_svc_ids[2], 3, CASE WHEN j = 1 THEN 2 ELSE 3 END),
          (v_cp, v_svc_ids[7], 2, 2);

        IF j = 1 THEN
          INSERT INTO public.package_redemptions
            (client_package_id, brand_id, service_id, client_id, covered_amount, currency)
          VALUES (v_cp, b.id, v_svc_ids[2], v_cli_ids[(i * 2) + j], 420, b.currency);
        END IF;
      ELSE
        INSERT INTO public.client_package_service_balances
          (client_package_id, service_id, included_count, remaining_count)
        VALUES (v_cp, v_svc_ids[5], 2, 2), (v_cp, v_svc_ids[6], 2, 2);
      END IF;
    END LOOP;
  END LOOP;

  RAISE NOTICE 'sample data seeded for %', b.name;
END LOOP;
END $$;

COMMIT;

-- ---------------------------------------------------------------------------
-- FINAL RESULT — after COMMIT so the editor shows it.
--
-- The two columns that matter most are the last ones: `bookable_violations`
-- recomputes the bookable-staff restriction from scratch across appointments
-- AND staff_services, and `overlaps` re-derives whether any two non-cancelled
-- appointments for the same staff member intersect. Both must read 0. They are
-- checked here rather than trusted, because the triggers that enforce them are
-- exactly the kind of guard this project has twice found to be inert.
-- ---------------------------------------------------------------------------
SELECT
  "brand", "services", "price_overrides", "products", "stock_rows", "low_or_zero",
  "clients", "staff_services", "schedules", "appointments",
  "completed", "no_show", "cancelled", "scheduled",
  "service_records", "income_rows", "income_total",
  "gift_cards", "package_types", "packages_sold", "bookable_violations", "overlaps"
FROM (
SELECT
  1 AS ord,
  b.name AS "brand",
  (SELECT count(*) FROM public.services s WHERE s.brand_id = b.id)                                        AS "services",
  (SELECT count(*) FROM public.service_location_prices p
     JOIN public.services s ON s.id = p.service_id WHERE s.brand_id = b.id)                               AS "price_overrides",
  (SELECT count(*) FROM public.products p WHERE p.brand_id = b.id)                                        AS "products",
  (SELECT count(*) FROM public.location_stock ls
     JOIN public.locations l ON l.id = ls.location_id WHERE l.brand_id = b.id)                            AS "stock_rows",
  (SELECT count(*) FROM public.location_stock ls
     JOIN public.locations l ON l.id = ls.location_id
    WHERE l.brand_id = b.id AND ls.quantity <= ls.low_stock_threshold)                                    AS "low_or_zero",
  (SELECT count(*) FROM public.clients c WHERE c.brand_id = b.id)                                         AS "clients",
  (SELECT count(*) FROM public.staff_services ss WHERE ss.brand_id = b.id)                                AS "staff_services",
  (SELECT count(*) FROM public.staff_schedules sch
     JOIN public.locations l ON l.id = sch.location_id WHERE l.brand_id = b.id)                           AS "schedules",
  (SELECT count(*) FROM public.appointments a WHERE a.brand_id = b.id)                                    AS "appointments",
  (SELECT count(*) FROM public.appointments a WHERE a.brand_id = b.id AND a.status = 'completed')         AS "completed",
  (SELECT count(*) FROM public.appointments a WHERE a.brand_id = b.id AND a.status = 'no_show')           AS "no_show",
  (SELECT count(*) FROM public.appointments a WHERE a.brand_id = b.id AND a.status = 'cancelled')         AS "cancelled",
  (SELECT count(*) FROM public.appointments a WHERE a.brand_id = b.id AND a.status = 'scheduled')         AS "scheduled",
  (SELECT count(*) FROM public.service_records sr
     JOIN public.appointments a ON a.id = sr.appointment_id WHERE a.brand_id = b.id)                      AS "service_records",
  (SELECT count(*) FROM public.income_records ir WHERE ir.brand_id = b.id)                                AS "income_rows",
  (SELECT coalesce(sum(ir.amount), 0) FROM public.income_records ir WHERE ir.brand_id = b.id)             AS "income_total",
  (SELECT count(*) FROM public.gift_cards g WHERE g.brand_id = b.id)                                      AS "gift_cards",
  (SELECT count(*) FROM public.package_types pt WHERE pt.brand_id = b.id)                                 AS "package_types",
  (SELECT count(*) FROM public.client_packages cp WHERE cp.brand_id = b.id)                               AS "packages_sold",
  -- Non-staff actors anywhere they are forbidden.
  (SELECT count(*) FROM public.appointments a
     WHERE a.brand_id = b.id
       AND NOT EXISTS (SELECT 1 FROM public.user_roles r
                        WHERE r.user_id = a.staff_user_id AND r.brand_id = b.id AND r.role = 'staff'))
  + (SELECT count(*) FROM public.staff_services ss
     WHERE ss.brand_id = b.id
       AND NOT EXISTS (SELECT 1 FROM public.user_roles r
                        WHERE r.user_id = ss.user_id AND r.brand_id = b.id AND r.role = 'staff'))         AS "bookable_violations",
  (SELECT count(*) FROM public.appointments a
     JOIN public.appointments a2
       ON a2.staff_user_id = a.staff_user_id AND a2.id <> a.id
      AND a2.status <> 'cancelled' AND a.status <> 'cancelled'
      AND a.starts_at < a2.ends_at AND a.ends_at > a2.starts_at
    WHERE a.brand_id = b.id)                                                                              AS "overlaps"
FROM public.brands b

UNION ALL

SELECT
  2, 'TOTAL',
  (SELECT count(*) FROM public.services),
  (SELECT count(*) FROM public.service_location_prices),
  (SELECT count(*) FROM public.products),
  (SELECT count(*) FROM public.location_stock),
  (SELECT count(*) FROM public.location_stock WHERE quantity <= low_stock_threshold),
  (SELECT count(*) FROM public.clients),
  (SELECT count(*) FROM public.staff_services),
  (SELECT count(*) FROM public.staff_schedules),
  (SELECT count(*) FROM public.appointments),
  (SELECT count(*) FROM public.appointments WHERE status = 'completed'),
  (SELECT count(*) FROM public.appointments WHERE status = 'no_show'),
  (SELECT count(*) FROM public.appointments WHERE status = 'cancelled'),
  (SELECT count(*) FROM public.appointments WHERE status = 'scheduled'),
  (SELECT count(*) FROM public.service_records),
  (SELECT count(*) FROM public.income_records),
  (SELECT coalesce(sum(amount), 0) FROM public.income_records),
  (SELECT count(*) FROM public.gift_cards),
  (SELECT count(*) FROM public.package_types),
  (SELECT count(*) FROM public.client_packages),
  (SELECT count(*) FROM public.appointments a
     WHERE NOT EXISTS (SELECT 1 FROM public.user_roles r
                        WHERE r.user_id = a.staff_user_id AND r.role = 'staff'))
  + (SELECT count(*) FROM public.staff_services ss
     WHERE NOT EXISTS (SELECT 1 FROM public.user_roles r
                        WHERE r.user_id = ss.user_id AND r.role = 'staff')),
  (SELECT count(*) FROM public.appointments a
     JOIN public.appointments a2
       ON a2.staff_user_id = a.staff_user_id AND a2.id <> a.id
      AND a2.status <> 'cancelled' AND a.status <> 'cancelled'
      AND a.starts_at < a2.ends_at AND a.ends_at > a2.starts_at)
) x
ORDER BY ord, "brand";
