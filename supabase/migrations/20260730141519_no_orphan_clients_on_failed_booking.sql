-- Failed bookings were leaving orphan client rows behind. The client INSERT sat
-- outside the BEGIN..EXCEPTION block wrapping the appointment INSERT, so a
-- slot_taken collision rolled back only the appointment — the client row
-- persisted with zero appointments. Because clients are shared brand-wide and
-- surface in /app/clients, every real-world collision polluted the salon's
-- client list.
--
-- Fix: the client INSERT now happens inside the same BEGIN..EXCEPTION block
-- (which is an implicit savepoint in plpgsql), so client + appointment roll back
-- together. The lookup of an *existing* client stays outside the block since
-- it's read-only — an already-existing client row is never created, modified, or
-- rolled back either way.

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

  -- Read-only: an existing client is matched, never written to.
  SELECT id INTO v_client_id FROM public.clients
    WHERE brand_id = _brand_id AND phone = _phone LIMIT 1;

  BEGIN
    -- Creating a new client and inserting the appointment must succeed or fail
    -- as a unit, so a collision doesn't leave a phantom client behind.
    IF v_client_id IS NULL THEN
      INSERT INTO public.clients(brand_id, name, phone)
      VALUES (_brand_id, COALESCE(NULLIF(_client_name,''), 'Guest'), _phone)
      RETURNING id INTO v_client_id;
    END IF;

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
