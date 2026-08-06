-- Only a Staff/Technician account may be assigned as bookable staff.
--
-- Rule: appointments.staff_user_id and staff_services.user_id must reference a
-- user holding role = 'staff' in the SAME brand. Owner, Manager and
-- Receptionist are never bookable, on any path — internal booking, self-booking,
-- "no preference" auto-assignment, or a hand-crafted request against the RPCs.
--
-- Why a trigger and not a CHECK constraint: a CHECK may only read the row it is
-- checking. The fact we need ("what role does this user hold in this brand?")
-- lives in another table, so a trigger is the only real option in Postgres.
--
-- Three deliberate choices, each earned from a bug class in Section 4 of the
-- spec:
--
--  * is_bookable_staff() is SECURITY DEFINER because user_roles is RLS-protected
--    and a Receptionist cannot SELECT the Staff member's role row (only Owners
--    and that user's own row are visible to them). Without SECURITY DEFINER the
--    lookup would return "no staff role found" for a perfectly valid booking and
--    the guard would fail CLOSED on the most common booking path in the product.
--    It makes no authorisation decision about the *caller* — it only reads a
--    fact about the *referenced* user — so bug class 12 (current_user inside
--    SECURITY DEFINER) does not apply: there is no caller-identity test here to
--    get wrong.
--
--  * STABLE, never IMMUTABLE (bug class 8). It reads a table; a constant-folded
--    answer would let a stale role decide who is bookable.
--
--  * The UPDATE path re-checks ONLY when the assignment actually changes. This
--    is bug class 4 in a new costume: a guard that re-validates an untouched
--    column turns every unrelated UPDATE into a potential failure. Marking a
--    legacy appointment completed, cancelling it, or settling it must not be
--    blocked by who was assigned to it months ago. Changing the assignment is
--    what the rule is about, so that is what gets checked.
--
-- Deliberately NOT enforced here: that the Staff member's user_roles.location_id
-- matches the appointment's location. The pickers and RPCs scope by location;
-- widening the trigger to location would reject a legitimate cross-branch cover
-- shift, which is a product decision nobody has made.

-- ---------------------------------------------------------------------------
-- The fact, in one place, so the trigger and the RPCs cannot drift apart
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.is_bookable_staff(_user_id uuid, _brand_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles ur
    WHERE ur.user_id  = _user_id
      AND ur.brand_id = _brand_id
      AND ur.role     = 'staff'
  );
$$;

COMMENT ON FUNCTION public.is_bookable_staff IS
  'Single source of truth for "may this user be assigned as bookable staff for this brand?". Used by the enforcement trigger and by the public booking RPCs so they cannot disagree about who is bookable.';

REVOKE ALL ON FUNCTION public.is_bookable_staff(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_bookable_staff(uuid, uuid) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Enforcement trigger, shared by both tables
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.enforce_bookable_staff_role()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  v_user_id  uuid;
  v_brand_id uuid;
  v_column   text;
BEGIN
  IF TG_TABLE_NAME = 'appointments' THEN
    v_user_id  := NEW.staff_user_id;
    v_brand_id := NEW.brand_id;
    v_column   := 'appointments.staff_user_id';
    IF TG_OP = 'UPDATE'
       AND NEW.staff_user_id IS NOT DISTINCT FROM OLD.staff_user_id
       AND NEW.brand_id      IS NOT DISTINCT FROM OLD.brand_id THEN
      RETURN NEW;
    END IF;
  ELSE
    v_user_id  := NEW.user_id;
    v_brand_id := NEW.brand_id;
    v_column   := 'staff_services.user_id';
    IF TG_OP = 'UPDATE'
       AND NEW.user_id  IS NOT DISTINCT FROM OLD.user_id
       AND NEW.brand_id IS NOT DISTINCT FROM OLD.brand_id THEN
      RETURN NEW;
    END IF;
  END IF;

  -- Nothing assigned yet is not a violation; appointments.staff_user_id is
  -- NOT NULL anyway, so this only ever spares a future nullable caller.
  IF v_user_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF NOT public.is_bookable_staff(v_user_id, v_brand_id) THEN
    -- ERRCODE is deliberately left at the plpgsql default (P0001 raise_exception)
    -- rather than check_violation: public_book_appointment catches
    -- check_violation and reports it to the client as 'slot_taken'. A role
    -- rejection surfacing as "that slot was just taken" would send the client
    -- round the picker forever chasing a slot that was never the problem.
    RAISE EXCEPTION
      'not_bookable_staff: % must reference an account with role = ''staff'' in brand % (user % does not hold it)',
      v_column, v_brand_id, v_user_id;
  END IF;

  RETURN NEW;
END $function$;

COMMENT ON FUNCTION public.enforce_bookable_staff_role IS
  'Rejects assigning a non-Staff account as bookable staff. Re-checks on UPDATE only when the assignment itself changes, so unrelated updates to legacy rows are not blocked.';

DROP TRIGGER IF EXISTS enforce_bookable_staff_role_trg ON public.appointments;
CREATE TRIGGER enforce_bookable_staff_role_trg
  BEFORE INSERT OR UPDATE ON public.appointments
  FOR EACH ROW EXECUTE FUNCTION public.enforce_bookable_staff_role();

DROP TRIGGER IF EXISTS enforce_bookable_staff_role_trg ON public.staff_services;
CREATE TRIGGER enforce_bookable_staff_role_trg
  BEFORE INSERT OR UPDATE ON public.staff_services
  FOR EACH ROW EXECUTE FUNCTION public.enforce_bookable_staff_role();

-- ---------------------------------------------------------------------------
-- Self-booking RPCs: stop offering non-Staff accounts in the first place.
--
-- All three carried the same clause:
--     AND (ur.location_id = _location_id OR ur.role IN ('owner','manager'))
-- which existed because owner/manager role rows carry location_id = NULL and
-- would otherwise never match a location. Its side effect was that any Owner or
-- Manager with a staff_services row was a bookable option to the public — and,
-- in public_book_appointment, a candidate for "no preference" auto-assignment.
-- Replaced by an explicit role test plus the location match that Staff rows
-- genuinely carry.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.public_list_staff_for_service(
  _brand_id uuid, _location_id uuid, _service_id uuid
) RETURNS TABLE(user_id uuid, full_name text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
  SELECT DISTINCT ur.user_id, COALESCE(p.full_name, 'Staff') AS full_name
  FROM public.user_roles ur
  JOIN public.staff_services ss
    ON ss.user_id = ur.user_id AND ss.service_id = _service_id AND ss.brand_id = _brand_id
  LEFT JOIN public.profiles p ON p.id = ur.user_id
  WHERE ur.brand_id = _brand_id
    AND ur.user_id IS NOT NULL
    AND ur.role = 'staff'
    AND ur.location_id = _location_id
  ORDER BY full_name;
$function$;

CREATE OR REPLACE FUNCTION public.public_compute_slots(
  _brand_id uuid, _location_id uuid, _service_id uuid, _staff_user_id uuid,
  _date_from date, _date_to date
)
RETURNS TABLE(starts_at timestamptz, ends_at timestamptz, staff_user_id uuid)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  v_duration int;
  v_min_notice int;
  v_max_advance int;
  v_earliest timestamptz;
  v_latest timestamptz;
  v_tz text;
BEGIN
  SELECT duration_minutes INTO v_duration
  FROM public.services WHERE id = _service_id AND brand_id = _brand_id AND is_active = true;
  IF v_duration IS NULL THEN RETURN; END IF;

  SELECT min_notice_hours, max_advance_days
    INTO v_min_notice, v_max_advance FROM public.brands WHERE id = _brand_id;
  SELECT timezone INTO v_tz FROM public.locations WHERE id = _location_id;
  v_tz := COALESCE(v_tz, 'UTC');
  v_earliest := now() + make_interval(hours => COALESCE(v_min_notice, 3));
  v_latest   := LEAST(_date_to::timestamptz + interval '1 day',
                      now() + make_interval(days => COALESCE(v_max_advance, 30)));

  RETURN QUERY
  WITH candidate_staff AS (
    SELECT DISTINCT ur.user_id
    FROM public.user_roles ur
    JOIN public.staff_services ss
      ON ss.user_id = ur.user_id AND ss.service_id = _service_id AND ss.brand_id = _brand_id
    WHERE ur.brand_id = _brand_id
      AND ur.user_id IS NOT NULL
      AND (_staff_user_id IS NULL OR ur.user_id = _staff_user_id)
      AND ur.role = 'staff'
      AND ur.location_id = _location_id
  ),
  days AS (
    SELECT d::date AS day
    FROM generate_series(_date_from, _date_to, '1 day'::interval) d
  ),
  windows AS (
    SELECT sch.user_id,
           ((days.day::text || ' ' || sch.start_time::text)::timestamp AT TIME ZONE v_tz) AS win_start,
           ((days.day::text || ' ' || sch.end_time::text)::timestamp   AT TIME ZONE v_tz) AS win_end
    FROM public.staff_schedules sch
    JOIN candidate_staff cs ON cs.user_id = sch.user_id
    JOIN days ON EXTRACT(DOW FROM days.day)::int = sch.day_of_week
    WHERE sch.location_id = _location_id
      AND NOT EXISTS (
        SELECT 1 FROM public.staff_leave sl
        WHERE sl.user_id = sch.user_id
          AND days.day BETWEEN sl.start_date AND sl.end_date
      )
  ),
  slot_starts AS (
    SELECT w.user_id,
           gs AS s_start,
           gs + make_interval(mins => v_duration) AS s_end
    FROM windows w
    CROSS JOIN LATERAL generate_series(
      w.win_start,
      w.win_end - make_interval(mins => v_duration),
      '15 minutes'::interval
    ) AS gs
  )
  SELECT ss.s_start, ss.s_end, ss.user_id
  FROM slot_starts ss
  WHERE ss.s_start >= v_earliest
    AND ss.s_start <= v_latest
    AND NOT EXISTS (
      SELECT 1 FROM public.appointments a
      WHERE a.staff_user_id = ss.user_id
        AND public.appointment_holds_slot(a.status, a.deposit_status, a.deposit_hold_expires_at)
        AND a.starts_at < ss.s_end
        AND a.ends_at   > ss.s_start
    )
  ORDER BY ss.s_start, ss.user_id;
END $function$;

-- public_book_appointment: same fix on the auto-assign pool, PLUS an explicit
-- check on a caller-supplied staff id. _staff_user_id arrives from the browser,
-- so without this a crafted request would reach the trigger and surface as an
-- unhandled 500 instead of a clean, expected booking error.
CREATE OR REPLACE FUNCTION public.public_book_appointment(
  _brand_id uuid, _location_id uuid, _service_id uuid, _staff_user_id uuid,
  _starts_at timestamptz, _client_name text, _phone text, _notes text,
  _deposit_skipped boolean DEFAULT false
) RETURNS TABLE(
  appointment_id   uuid,
  token            text,
  error            text,
  deposit_required boolean,
  deposit_amount   numeric,
  hold_expires_at  timestamptz
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  v_client_id uuid; v_service RECORD; v_ends timestamptz;
  v_appt uuid; v_token text; v_staff uuid := _staff_user_id;
  v_dep RECORD; v_hold_minutes int; v_hold_expires timestamptz;
  v_dep_status public.deposit_status; v_skipped boolean := false;
BEGIN
  SELECT s.duration_minutes,
         COALESCE(slp.price, s.default_price) AS price,
         COALESCE(slp.currency, s.currency)   AS currency
    INTO v_service
  FROM public.services s
  LEFT JOIN public.service_location_prices slp
    ON slp.service_id = s.id AND slp.location_id = _location_id
  WHERE s.id = _service_id AND s.brand_id = _brand_id AND s.is_active = true;
  IF NOT FOUND THEN
    RETURN QUERY SELECT NULL::uuid, NULL::text, 'service_unavailable'::text,
                        false, NULL::numeric, NULL::timestamptz; RETURN;
  END IF;

  v_ends := _starts_at + make_interval(mins => v_service.duration_minutes);

  -- A client-supplied staff id is untrusted input. Reject a non-Staff account
  -- here, with a clean error, rather than letting the trigger raise.
  IF v_staff IS NOT NULL AND NOT public.is_bookable_staff(v_staff, _brand_id) THEN
    RETURN QUERY SELECT NULL::uuid, NULL::text, 'staff_unavailable'::text,
                        false, NULL::numeric, NULL::timestamptz; RETURN;
  END IF;

  IF v_staff IS NULL THEN
    SELECT ur.user_id INTO v_staff
    FROM public.user_roles ur
    JOIN public.staff_services ss
      ON ss.user_id = ur.user_id AND ss.service_id = _service_id
    WHERE ur.brand_id = _brand_id
      AND ur.user_id IS NOT NULL
      AND ur.role = 'staff'
      AND ur.location_id = _location_id
      AND NOT EXISTS (
        SELECT 1 FROM public.appointments a
        WHERE a.staff_user_id = ur.user_id
          AND public.appointment_holds_slot(a.status, a.deposit_status, a.deposit_hold_expires_at)
          AND a.starts_at < v_ends AND a.ends_at > _starts_at
      )
    LIMIT 1;
    IF v_staff IS NULL THEN
      RETURN QUERY SELECT NULL::uuid, NULL::text, 'no_staff_available'::text,
                          false, NULL::numeric, NULL::timestamptz; RETURN;
    END IF;
  END IF;

  SELECT * INTO v_dep FROM public.public_resolve_deposit(_brand_id, _service_id, _location_id, _phone);

  IF v_dep.deposit_required AND _deposit_skipped THEN
    IF v_dep.deposit_mandatory THEN
      RETURN QUERY SELECT NULL::uuid, NULL::text, 'deposit_required'::text,
                          true, v_dep.deposit_amount, NULL::timestamptz; RETURN;
    END IF;
    v_skipped := true;
  END IF;

  IF v_dep.deposit_required AND NOT v_skipped THEN
    SELECT deposit_hold_minutes INTO v_hold_minutes FROM public.brands WHERE id = _brand_id;
    v_hold_expires := now() + make_interval(mins => COALESCE(v_hold_minutes, 15));
    v_dep_status := 'pending';
  END IF;

  SELECT id INTO v_client_id FROM public.clients
    WHERE brand_id = _brand_id AND phone = _phone LIMIT 1;

  BEGIN
    IF v_client_id IS NULL THEN
      INSERT INTO public.clients(brand_id, name, phone)
      VALUES (_brand_id, COALESCE(NULLIF(_client_name,''), 'Guest'), _phone)
      RETURNING id INTO v_client_id;
    END IF;

    INSERT INTO public.appointments(
      brand_id, location_id, client_id, staff_user_id, service_id,
      starts_at, ends_at, status, notes, price, currency,
      deposit_status, deposit_amount, deposit_hold_expires_at, deposit_skipped
    ) VALUES (
      _brand_id, _location_id, v_client_id, v_staff, _service_id,
      _starts_at, v_ends, 'scheduled', _notes, v_service.price, v_service.currency,
      v_dep_status,
      CASE WHEN v_dep.deposit_required AND NOT v_skipped THEN v_dep.deposit_amount END,
      v_hold_expires, v_skipped
    ) RETURNING id INTO v_appt;
  EXCEPTION WHEN check_violation THEN
    RETURN QUERY SELECT NULL::uuid, NULL::text, 'slot_taken'::text,
                        false, NULL::numeric, NULL::timestamptz; RETURN;
  END;

  v_token := replace(replace(replace(encode(extensions.gen_random_bytes(24),'base64'),'+','-'),'/','_'),'=','');
  INSERT INTO public.booking_tokens(token, appointment_id, expires_at)
  VALUES (v_token, v_appt, v_ends + interval '30 days');

  IF v_dep_status = 'pending' THEN
    INSERT INTO public.payment_events (appointment_id, event_type, payload)
    VALUES (v_appt, 'deposit.hold_created',
            jsonb_build_object('amount', v_dep.deposit_amount, 'expires_at', v_hold_expires));
  END IF;

  RETURN QUERY SELECT v_appt, v_token, NULL::text,
                      COALESCE(v_dep_status = 'pending', false),
                      CASE WHEN v_dep_status = 'pending' THEN v_dep.deposit_amount END,
                      v_hold_expires;
END $function$;

-- Reschedule takes a caller-supplied staff id from the manage link, so it needs
-- the same explicit check for the same reason.
CREATE OR REPLACE FUNCTION public.public_reschedule_by_token(
  _token text, _new_starts_at timestamptz, _new_staff_user_id uuid
) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE v_appt public.appointments; v_dur int; v_ends timestamptz; v_staff uuid;
BEGIN
  SELECT a.* INTO v_appt
  FROM public.booking_tokens bt
  JOIN public.appointments a ON a.id = bt.appointment_id
  WHERE bt.token = _token
    AND (bt.expires_at IS NULL OR bt.expires_at > now())
    AND a.status = 'scheduled'
    AND a.starts_at > now();
  IF v_appt.id IS NULL THEN RETURN 'invalid_token'; END IF;

  IF _new_staff_user_id IS NOT NULL
     AND NOT public.is_bookable_staff(_new_staff_user_id, v_appt.brand_id) THEN
    RETURN 'staff_unavailable';
  END IF;

  SELECT duration_minutes INTO v_dur FROM public.services WHERE id = v_appt.service_id;
  v_ends := _new_starts_at + make_interval(mins => COALESCE(v_dur, 30));
  v_staff := COALESCE(_new_staff_user_id, v_appt.staff_user_id);
  BEGIN
    UPDATE public.appointments
      SET starts_at = _new_starts_at,
          ends_at   = v_ends,
          staff_user_id = v_staff
      WHERE id = v_appt.id;
  EXCEPTION WHEN check_violation THEN
    RETURN 'slot_taken';
  END;
  RETURN 'ok';
END $function$;

-- Re-apply the service_role-only lockdown to the functions redefined above.
-- CREATE OR REPLACE preserves existing grants, but a fresh signature would not,
-- and public_book_appointment has been re-created here.
DO $$
DECLARE fn RECORD;
BEGIN
  FOR fn IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN ('public_list_staff_for_service','public_compute_slots',
                        'public_book_appointment','public_reschedule_by_token')
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', fn.sig);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM anon', fn.sig);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM authenticated', fn.sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', fn.sig);
  END LOOP;
END $$;
