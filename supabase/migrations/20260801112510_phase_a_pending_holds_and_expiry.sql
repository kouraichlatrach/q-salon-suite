-- Payments Phase A — slot-holding + expiry (spec items 8 & 9).
--
-- Item 8: a pending-deposit appointment must count against the hard DB overlap
-- trigger immediately, so the hold is real rather than UI-only.
-- Item 9: expired-but-still-pending rows must be treated as if they don't
-- exist, on read, so availability is instantly correct without depending on
-- any background job having run.
--
-- Both rules are expressed once, in appointment_holds_slot(), so the overlap
-- trigger and public_compute_slots can never drift apart. Drift between two
-- copies of this rule would mean the trigger rejects a slot the picker just
-- offered (or worse, allows a genuine double-booking).

CREATE OR REPLACE FUNCTION public.appointment_holds_slot(
  _status          public.appointment_status,
  _deposit_status  public.deposit_status,
  _hold_expires_at timestamptz
) RETURNS boolean
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT
    -- cancelled never holds a slot (pre-existing behaviour)
    _status <> 'cancelled'
    -- an unpaid hold past its expiry stops holding, immediately, on read
    AND NOT (
      _deposit_status = 'pending'
      AND _hold_expires_at IS NOT NULL
      AND _hold_expires_at <= now()
    );
$$;

COMMENT ON FUNCTION public.appointment_holds_slot IS
  'Single source of truth for "does this appointment occupy its slot?". Used by both prevent_appointment_overlap and public_compute_slots so they cannot disagree.';

-- ---------------------------------------------------------------------------
-- Overlap trigger: same guarantee, now expiry-aware on both sides
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.prevent_appointment_overlap()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
BEGIN
  IF NEW.status = 'cancelled' THEN
    RETURN NEW;
  END IF;
  IF NEW.ends_at <= NEW.starts_at THEN
    RAISE EXCEPTION 'Appointment end time must be after start time' USING ERRCODE = 'check_violation';
  END IF;

  -- A row being inserted as an expired hold cannot claim a slot either; without
  -- this the incoming row would be exempt from the rule it imposes on others.
  IF NOT public.appointment_holds_slot(NEW.status, NEW.deposit_status, NEW.deposit_hold_expires_at) THEN
    RETURN NEW;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.appointments a
    WHERE a.staff_user_id = NEW.staff_user_id
      AND a.id <> COALESCE(NEW.id, '00000000-0000-0000-0000-000000000000'::uuid)
      -- was: a.status <> 'cancelled'
      AND public.appointment_holds_slot(a.status, a.deposit_status, a.deposit_hold_expires_at)
      AND a.starts_at < NEW.ends_at
      AND a.ends_at   > NEW.starts_at
  ) THEN
    RAISE EXCEPTION 'Staff member already has an overlapping appointment' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $function$;

-- ---------------------------------------------------------------------------
-- Availability: identical rule, so the picker and the trigger agree
-- ---------------------------------------------------------------------------

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
      AND (ur.location_id = _location_id OR ur.role IN ('owner','manager'))
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
        -- was: a.status <> 'cancelled'
        AND public.appointment_holds_slot(a.status, a.deposit_status, a.deposit_hold_expires_at)
        AND a.starts_at < ss.s_end
        AND a.ends_at   > ss.s_start
    )
  ORDER BY ss.s_start, ss.user_id;
END $function$;

-- ---------------------------------------------------------------------------
-- Item 9, second half: periodic cleanup, for data hygiene only.
-- Nothing depends on this having run recently — availability is already correct
-- via check-on-read above. This only stops abandoned payment attempts
-- cluttering Reports and the calendar.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.expire_stale_deposit_holds(_older_than_minutes int DEFAULT 60)
RETURNS TABLE(expired_count int)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE v_ids uuid[];
BEGIN
  WITH stale AS (
    SELECT id FROM public.appointments
    WHERE deposit_status = 'pending'
      AND deposit_hold_expires_at IS NOT NULL
      AND deposit_hold_expires_at <= now() - make_interval(mins => _older_than_minutes)
      AND status <> 'cancelled'
    FOR UPDATE SKIP LOCKED
  ), upd AS (
    UPDATE public.appointments a
    SET deposit_status = 'expired', status = 'cancelled', updated_at = now()
    FROM stale s WHERE a.id = s.id
    RETURNING a.id
  )
  SELECT array_agg(id) INTO v_ids FROM upd;

  -- Audit trail for every automated state change (append-only log).
  IF v_ids IS NOT NULL THEN
    INSERT INTO public.payment_events (appointment_id, event_type, payload)
    SELECT unnest(v_ids), 'deposit.hold_expired',
           jsonb_build_object('reason','cleanup_job','older_than_minutes',_older_than_minutes);
  END IF;

  RETURN QUERY SELECT COALESCE(array_length(v_ids,1), 0);
END $function$;

REVOKE ALL ON FUNCTION public.expire_stale_deposit_holds(int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.expire_stale_deposit_holds(int) TO service_role;
