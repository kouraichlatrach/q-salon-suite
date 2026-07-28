
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ============================================================
-- brands: slug + booking-window settings + sms sender
-- ============================================================
ALTER TABLE public.brands
  ADD COLUMN IF NOT EXISTS slug text,
  ADD COLUMN IF NOT EXISTS min_notice_hours int NOT NULL DEFAULT 3,
  ADD COLUMN IF NOT EXISTS max_advance_days int NOT NULL DEFAULT 30,
  ADD COLUMN IF NOT EXISTS sms_sender text;

DO $$
DECLARE r RECORD; base TEXT; candidate TEXT; n INT;
BEGIN
  FOR r IN SELECT id, name FROM public.brands WHERE slug IS NULL LOOP
    base := regexp_replace(lower(coalesce(nullif(trim(r.name),''),'salon')), '[^a-z0-9]+', '-', 'g');
    base := trim(both '-' from base);
    IF base = '' THEN base := 'salon'; END IF;
    candidate := base; n := 1;
    WHILE EXISTS (SELECT 1 FROM public.brands WHERE slug = candidate) LOOP
      n := n + 1; candidate := base || '-' || n;
    END LOOP;
    UPDATE public.brands SET slug = candidate WHERE id = r.id;
  END LOOP;
END $$;

ALTER TABLE public.brands ALTER COLUMN slug SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS brands_slug_key ON public.brands(slug);

-- ============================================================
-- staff_services (staff <-> services capability)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.staff_services (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  brand_id uuid NOT NULL REFERENCES public.brands(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  service_id uuid NOT NULL REFERENCES public.services(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, service_id)
);
CREATE INDEX IF NOT EXISTS staff_services_service_idx ON public.staff_services(service_id);
CREATE INDEX IF NOT EXISTS staff_services_user_idx ON public.staff_services(user_id);

GRANT SELECT ON public.staff_services TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.staff_services TO authenticated;
GRANT ALL ON public.staff_services TO service_role;
ALTER TABLE public.staff_services ENABLE ROW LEVEL SECURITY;

CREATE POLICY "staff_services_public_read" ON public.staff_services FOR SELECT TO anon USING (true);
CREATE POLICY "staff_services_auth_read"   ON public.staff_services FOR SELECT TO authenticated USING (true);

CREATE POLICY "staff_services_owner_all" ON public.staff_services FOR ALL TO authenticated
  USING (public.is_brand_owner(auth.uid(), brand_id))
  WITH CHECK (public.is_brand_owner(auth.uid(), brand_id));

CREATE POLICY "staff_services_manager_manage" ON public.staff_services FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.user_roles mgr
      JOIN public.user_roles staff
        ON staff.brand_id = mgr.brand_id AND staff.user_id = staff_services.user_id
      WHERE mgr.user_id = auth.uid()
        AND mgr.role = 'manager'
        AND mgr.brand_id = staff_services.brand_id
        AND staff.location_id = mgr.location_id
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.user_roles mgr
      JOIN public.user_roles staff
        ON staff.brand_id = mgr.brand_id AND staff.user_id = staff_services.user_id
      WHERE mgr.user_id = auth.uid()
        AND mgr.role = 'manager'
        AND mgr.brand_id = staff_services.brand_id
        AND staff.location_id = mgr.location_id
    )
  );

-- ============================================================
-- booking_tokens
-- ============================================================
CREATE TABLE IF NOT EXISTS public.booking_tokens (
  token text PRIMARY KEY,
  appointment_id uuid NOT NULL REFERENCES public.appointments(id) ON DELETE CASCADE,
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS booking_tokens_appt_idx ON public.booking_tokens(appointment_id);
GRANT SELECT ON public.booking_tokens TO authenticated;
GRANT ALL ON public.booking_tokens TO service_role;
ALTER TABLE public.booking_tokens ENABLE ROW LEVEL SECURITY;
CREATE POLICY "booking_tokens_brand_read" ON public.booking_tokens FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.appointments a
    WHERE a.id = booking_tokens.appointment_id
      AND public.is_brand_member(auth.uid(), a.brand_id)
  ));

-- ============================================================
-- booking_otps  (service_role only)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.booking_otps (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  brand_id uuid NOT NULL REFERENCES public.brands(id) ON DELETE CASCADE,
  phone text NOT NULL,
  code_hash text NOT NULL,
  expires_at timestamptz NOT NULL,
  attempts int NOT NULL DEFAULT 0,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS booking_otps_lookup ON public.booking_otps(brand_id, phone, created_at DESC);
GRANT ALL ON public.booking_otps TO service_role;
ALTER TABLE public.booking_otps ENABLE ROW LEVEL SECURITY;
-- No policies: only service_role reaches this table.

-- ============================================================
-- RPCs (SECURITY DEFINER) — called from server functions via admin client
-- ============================================================

CREATE OR REPLACE FUNCTION public.public_get_brand_by_slug(_slug text)
RETURNS TABLE(id uuid, name text, slug text, currency text,
              min_notice_hours int, max_advance_days int, sms_sender text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT id, name, slug, currency, min_notice_hours, max_advance_days, sms_sender
  FROM public.brands WHERE slug = _slug;
$$;

CREATE OR REPLACE FUNCTION public.public_list_locations(_brand_id uuid)
RETURNS TABLE(id uuid, name text, address text, phone text, timezone text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT id, name, address, phone, timezone
  FROM public.locations
  WHERE brand_id = _brand_id AND is_active = true
  ORDER BY name;
$$;

CREATE OR REPLACE FUNCTION public.public_list_services(_brand_id uuid, _location_id uuid)
RETURNS TABLE(id uuid, name text, description text, category text,
              duration_minutes int, price numeric, currency text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT s.id, s.name, s.description, s.category, s.duration_minutes,
         COALESCE(slp.price, s.default_price) AS price,
         COALESCE(slp.currency, s.currency) AS currency
  FROM public.services s
  LEFT JOIN public.service_location_prices slp
    ON slp.service_id = s.id AND slp.location_id = _location_id
  WHERE s.brand_id = _brand_id AND s.is_active = true
  ORDER BY s.category NULLS LAST, s.name;
$$;

CREATE OR REPLACE FUNCTION public.public_list_staff_for_service(
  _brand_id uuid, _location_id uuid, _service_id uuid
) RETURNS TABLE(user_id uuid, full_name text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT DISTINCT ur.user_id, COALESCE(p.full_name, 'Staff') AS full_name
  FROM public.user_roles ur
  JOIN public.staff_services ss
    ON ss.user_id = ur.user_id AND ss.service_id = _service_id AND ss.brand_id = _brand_id
  LEFT JOIN public.profiles p ON p.id = ur.user_id
  WHERE ur.brand_id = _brand_id
    AND ur.user_id IS NOT NULL
    AND (ur.location_id = _location_id OR ur.role IN ('owner','manager'))
  ORDER BY full_name;
$$;

CREATE OR REPLACE FUNCTION public.public_compute_slots(
  _brand_id uuid, _location_id uuid, _service_id uuid,
  _staff_user_id uuid, _date_from date, _date_to date
) RETURNS TABLE(starts_at timestamptz, ends_at timestamptz, staff_user_id uuid)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
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
        AND a.status <> 'cancelled'
        AND a.starts_at < ss.s_end
        AND a.ends_at   > ss.s_start
    )
  ORDER BY ss.s_start, ss.user_id;
END $$;

CREATE OR REPLACE FUNCTION public.public_create_otp(
  _brand_id uuid, _phone text, _code text, _ttl_minutes int DEFAULT 10
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id uuid; v_recent int;
BEGIN
  SELECT count(*) INTO v_recent FROM public.booking_otps
    WHERE brand_id = _brand_id AND phone = _phone
      AND created_at > now() - interval '15 minutes';
  IF v_recent >= 5 THEN
    RAISE EXCEPTION 'rate_limited' USING ERRCODE = 'check_violation';
  END IF;
  INSERT INTO public.booking_otps(brand_id, phone, code_hash, expires_at)
  VALUES (_brand_id, _phone,
          crypt(_code, gen_salt('bf')),
          now() + make_interval(mins => _ttl_minutes))
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;

CREATE OR REPLACE FUNCTION public.public_verify_otp(
  _brand_id uuid, _phone text, _code text
) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_row public.booking_otps;
BEGIN
  SELECT * INTO v_row FROM public.booking_otps
    WHERE brand_id = _brand_id AND phone = _phone
      AND consumed_at IS NULL AND expires_at > now()
    ORDER BY created_at DESC LIMIT 1;
  IF NOT FOUND THEN RETURN false; END IF;
  IF v_row.attempts >= 5 THEN RETURN false; END IF;
  UPDATE public.booking_otps SET attempts = attempts + 1 WHERE id = v_row.id;
  IF v_row.code_hash = crypt(_code, v_row.code_hash) THEN
    UPDATE public.booking_otps SET consumed_at = now() WHERE id = v_row.id;
    RETURN true;
  END IF;
  RETURN false;
END $$;

CREATE OR REPLACE FUNCTION public.public_book_appointment(
  _brand_id uuid, _location_id uuid, _service_id uuid, _staff_user_id uuid,
  _starts_at timestamptz, _client_name text, _phone text, _notes text
) RETURNS TABLE(appointment_id uuid, token text, error text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_client_id uuid; v_service RECORD; v_ends timestamptz;
  v_appt uuid; v_token text; v_staff uuid := _staff_user_id;
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
    RETURN QUERY SELECT NULL::uuid, NULL::text, 'service_unavailable'::text; RETURN;
  END IF;

  v_ends := _starts_at + make_interval(mins => v_service.duration_minutes);

  IF v_staff IS NULL THEN
    SELECT ur.user_id INTO v_staff
    FROM public.user_roles ur
    JOIN public.staff_services ss
      ON ss.user_id = ur.user_id AND ss.service_id = _service_id
    WHERE ur.brand_id = _brand_id
      AND ur.user_id IS NOT NULL
      AND (ur.location_id = _location_id OR ur.role IN ('owner','manager'))
      AND NOT EXISTS (
        SELECT 1 FROM public.appointments a
        WHERE a.staff_user_id = ur.user_id AND a.status <> 'cancelled'
          AND a.starts_at < v_ends AND a.ends_at > _starts_at
      )
    LIMIT 1;
    IF v_staff IS NULL THEN
      RETURN QUERY SELECT NULL::uuid, NULL::text, 'no_staff_available'::text; RETURN;
    END IF;
  END IF;

  SELECT id INTO v_client_id FROM public.clients
    WHERE brand_id = _brand_id AND phone = _phone LIMIT 1;
  IF v_client_id IS NULL THEN
    INSERT INTO public.clients(brand_id, name, phone)
    VALUES (_brand_id, COALESCE(NULLIF(_client_name,''), 'Guest'), _phone)
    RETURNING id INTO v_client_id;
  END IF;

  BEGIN
    INSERT INTO public.appointments(
      brand_id, location_id, client_id, staff_user_id, service_id,
      starts_at, ends_at, status, notes, price, currency
    ) VALUES (
      _brand_id, _location_id, v_client_id, v_staff, _service_id,
      _starts_at, v_ends, 'scheduled', _notes, v_service.price, v_service.currency
    ) RETURNING id INTO v_appt;
  EXCEPTION WHEN check_violation THEN
    RETURN QUERY SELECT NULL::uuid, NULL::text, 'slot_taken'::text; RETURN;
  END;

  v_token := replace(replace(replace(encode(gen_random_bytes(24),'base64'),'+','-'),'/','_'),'=','');
  INSERT INTO public.booking_tokens(token, appointment_id, expires_at)
  VALUES (v_token, v_appt, v_ends + interval '30 days');

  RETURN QUERY SELECT v_appt, v_token, NULL::text;
END $$;

CREATE OR REPLACE FUNCTION public.public_get_appointment_by_token(_token text)
RETURNS TABLE(
  appointment_id uuid, brand_id uuid, brand_name text, brand_slug text,
  location_id uuid, location_name text, location_address text,
  service_id uuid, service_name text, duration_minutes int,
  staff_user_id uuid, staff_name text,
  client_name text, phone text,
  starts_at timestamptz, ends_at timestamptz, status appointment_status,
  price numeric, currency text
) LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT a.id, b.id, b.name, b.slug,
         l.id, l.name, l.address,
         s.id, s.name, s.duration_minutes,
         a.staff_user_id, COALESCE(p.full_name,'Staff'),
         c.name, c.phone, a.starts_at, a.ends_at, a.status,
         a.price, a.currency
  FROM public.booking_tokens bt
  JOIN public.appointments a ON a.id = bt.appointment_id
  JOIN public.brands b       ON b.id = a.brand_id
  JOIN public.locations l    ON l.id = a.location_id
  LEFT JOIN public.services s ON s.id = a.service_id
  LEFT JOIN public.profiles p ON p.id = a.staff_user_id
  JOIN public.clients c      ON c.id = a.client_id
  WHERE bt.token = _token
    AND (bt.expires_at IS NULL OR bt.expires_at > now());
$$;

CREATE OR REPLACE FUNCTION public.public_cancel_by_token(_token text)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_appt uuid;
BEGIN
  SELECT bt.appointment_id INTO v_appt
  FROM public.booking_tokens bt
  JOIN public.appointments a ON a.id = bt.appointment_id
  WHERE bt.token = _token
    AND (bt.expires_at IS NULL OR bt.expires_at > now())
    AND a.status = 'scheduled'
    AND a.starts_at > now();
  IF v_appt IS NULL THEN RETURN false; END IF;
  UPDATE public.appointments SET status = 'cancelled' WHERE id = v_appt;
  UPDATE public.booking_tokens SET expires_at = now() WHERE token = _token;
  RETURN true;
END $$;

CREATE OR REPLACE FUNCTION public.public_reschedule_by_token(
  _token text, _new_starts_at timestamptz, _new_staff_user_id uuid
) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
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
END $$;

CREATE OR REPLACE FUNCTION public.public_list_appointments_by_phone(
  _brand_id uuid, _phone text
) RETURNS TABLE(
  appointment_id uuid, token text,
  starts_at timestamptz, ends_at timestamptz,
  service_name text, location_name text, staff_name text,
  status appointment_status
) LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT a.id, bt.token, a.starts_at, a.ends_at,
         s.name, l.name, COALESCE(p.full_name,'Staff'), a.status
  FROM public.appointments a
  JOIN public.clients c   ON c.id = a.client_id
  LEFT JOIN public.services s ON s.id = a.service_id
  JOIN public.locations l  ON l.id = a.location_id
  LEFT JOIN public.profiles p ON p.id = a.staff_user_id
  LEFT JOIN public.booking_tokens bt
    ON bt.appointment_id = a.id
   AND (bt.expires_at IS NULL OR bt.expires_at > now())
  WHERE a.brand_id = _brand_id
    AND c.phone = _phone
    AND a.status = 'scheduled'
    AND a.starts_at > now()
  ORDER BY a.starts_at;
$$;
