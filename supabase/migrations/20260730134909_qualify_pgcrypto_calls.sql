-- pgcrypto lives in the `extensions` schema on this project, not `public`.
-- public_create_otp, public_verify_otp, and public_book_appointment are
-- SECURITY DEFINER with `SET search_path = public`, so their unqualified
-- calls to crypt()/gen_salt()/gen_random_bytes() failed to resolve
-- ("function gen_salt(unknown) does not exist"). Fully qualifying the
-- calls (rather than widening search_path) keeps the search_path minimal
-- for these SECURITY DEFINER functions, which is the safer fix.

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
          extensions.crypt(_code, extensions.gen_salt('bf')),
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
  IF v_row.code_hash = extensions.crypt(_code, v_row.code_hash) THEN
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

  v_token := replace(replace(replace(encode(extensions.gen_random_bytes(24),'base64'),'+','-'),'/','_'),'=','');
  INSERT INTO public.booking_tokens(token, appointment_id, expires_at)
  VALUES (v_token, v_appt, v_ends + interval '30 days');

  RETURN QUERY SELECT v_appt, v_token, NULL::text;
END $$;
